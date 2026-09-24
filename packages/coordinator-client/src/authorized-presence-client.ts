import {
  parseDeviceId,
  type DeviceId,
  type ProjectId,
} from "@floe-note/domain";

import { parseSessionId, type SessionId } from "./session-id.js";
import {
  AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
  SECURITY_HEAD_HASH_BYTES,
  SECURITY_PROTOCOL_VERSION,
  assertAuthorizedPresenceSignature,
  encodeAuthorizedPresenceProof,
} from "@floe-note/security";

export type AuthorizedPresenceConnectionState =
  | "idle"
  | "connecting"
  | "authenticating"
  | "open"
  | "closed"
  | "error";

export type ReconnectTransportMode = "direct" | "relay";

export type AuthorizedPresenceClientOptions = {
  coordinatorBaseUrl: string;
  projectId: ProjectId;
  deviceId: DeviceId;
  securityHead: Uint8Array;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
};

export class AuthorizedPresenceClient {
  readonly #url: URL;
  readonly #projectId: ProjectId;
  readonly #deviceId: DeviceId;
  readonly #securityHead: Uint8Array;
  readonly #sign: (message: Uint8Array) => Promise<Uint8Array>;
  readonly #stateHandlers = new Set<
    (state: AuthorizedPresenceConnectionState) => void
  >();
  readonly #deviceHandlers = new Set<
    (deviceIds: readonly DeviceId[]) => void
  >();
  readonly #errorHandlers = new Set<(error: Error) => void>();
  readonly #reconnectHandlers = new Set<
    (
      fromDeviceId: DeviceId,
      sessionId: SessionId,
      transportMode: ReconnectTransportMode,
    ) => void
  >();
  #socket: WebSocket | null = null;
  #state: AuthorizedPresenceConnectionState = "idle";
  #generation = 0;

  constructor(options: AuthorizedPresenceClientOptions) {
    this.#url = createPresenceWebSocketUrl(
      options.coordinatorBaseUrl,
      options.projectId,
    );
    this.#projectId = options.projectId;
    this.#deviceId = options.deviceId;
    this.#securityHead = options.securityHead.slice();
    this.#sign = options.sign;
  }

  get state(): AuthorizedPresenceConnectionState {
    return this.#state;
  }

  start(): void {
    if (this.#socket) return;

    this.#generation += 1;
    const generation = this.#generation;
    this.#setState("connecting");

    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (generation !== this.#generation || typeof event.data !== "string") {
        return;
      }

      void this.#handleMessage(socket, generation, event.data);
    });

    socket.addEventListener("close", (event) => {
      if (generation !== this.#generation) return;
      this.#socket = null;
      if (
        event.code === 1008 &&
        event.reason === "SecurityState changed"
      ) {
        this.#fail(new Error("SecurityState changed"));
        return;
      }
      if (this.#state !== "error") {
        this.#setState("closed");
      }
    });

    socket.addEventListener("error", () => {
      if (generation !== this.#generation) return;
      this.#fail(new Error("Authorized presence WebSocket failed"));
    });
  }

  onStateChange(
    handler: (state: AuthorizedPresenceConnectionState) => void,
  ): () => void {
    this.#stateHandlers.add(handler);
    handler(this.#state);
    return () => this.#stateHandlers.delete(handler);
  }

  onOnlineDevicesChange(
    handler: (deviceIds: readonly DeviceId[]) => void,
  ): () => void {
    this.#deviceHandlers.add(handler);
    return () => this.#deviceHandlers.delete(handler);
  }

  onError(handler: (error: Error) => void): () => void {
    this.#errorHandlers.add(handler);
    return () => this.#errorHandlers.delete(handler);
  }

  onReconnectSession(
    handler: (
      fromDeviceId: DeviceId,
      sessionId: SessionId,
      transportMode: ReconnectTransportMode,
    ) => void,
  ): () => void {
    this.#reconnectHandlers.add(handler);
    return () => this.#reconnectHandlers.delete(handler);
  }

  sendReconnectSession(
    peerDeviceId: DeviceId,
    sessionId: SessionId,
    transportMode: ReconnectTransportMode = "direct",
  ): void {
    if (
      this.#socket?.readyState !== WebSocket.OPEN ||
      this.#state !== "open"
    ) {
      throw new Error("Authorized presence WebSocket is not open");
    }

    this.#socket.send(
      JSON.stringify({
        type: "reconnect-session",
        peerDeviceId,
        sessionId,
        transportMode,
      }),
    );
  }

  close(): void {
    this.#generation += 1;
    this.#socket?.close(1000, "Authorized presence ended");
    this.#socket = null;
    this.#setState("closed");
    this.#deviceHandlers.clear();
    this.#stateHandlers.clear();
    this.#errorHandlers.clear();
    this.#reconnectHandlers.clear();
  }

  async #handleMessage(
    socket: WebSocket,
    generation: number,
    rawMessage: string,
  ): Promise<void> {
    try {
      const parsed = JSON.parse(rawMessage) as unknown;
      if (isChallengeMessage(parsed)) {
        await this.#answerChallenge(socket, generation, parsed);
        return;
      }

      if (isPresenceStateMessage(parsed)) {
        const deviceIds = parsed.deviceIds.map(parseDeviceId);
        this.#setState("open");
        for (const handler of this.#deviceHandlers) {
          handler(deviceIds);
        }
        return;
      }

      if (isReconnectSessionMessage(parsed)) {
        const fromDeviceId = parseDeviceId(parsed.fromDeviceId);
        const sessionId = parseSessionId(parsed.sessionId);
        const transportMode = parsed.transportMode ?? "direct";
        for (const handler of this.#reconnectHandlers) {
          handler(fromDeviceId, sessionId, transportMode);
        }
        return;
      }

      throw new Error("Invalid authorized-presence server message");
    } catch (error: unknown) {
      if (generation !== this.#generation) return;
      this.#fail(
        error instanceof Error
          ? error
          : new Error("Failed to process authorized presence message"),
      );
      socket.close(1008, "Authorized presence protocol error");
    }
  }

  async #answerChallenge(
    socket: WebSocket,
    generation: number,
    message: PresenceChallengeMessage,
  ): Promise<void> {
    this.#setState("authenticating");

    const challenge = hexToBytes(
      message.challenge,
      AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
      "Presence challenge",
    );
    const securityHead = hexToBytes(
      message.securityHead,
      SECURITY_HEAD_HASH_BYTES,
      "Security head",
    );

    if (!bytesEqual(securityHead, this.#securityHead)) {
      throw new Error(
        "Coordinator SecurityState changed before authorized presence authentication",
      );
    }

    const signingBytes = encodeAuthorizedPresenceProof({
      protocolVersion: SECURITY_PROTOCOL_VERSION,
      projectId: this.#projectId,
      deviceId: this.#deviceId,
      securityHead,
      challenge,
    });
    const signature = await this.#sign(signingBytes);
    assertAuthorizedPresenceSignature(signature);

    if (
      generation !== this.#generation ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "presence-auth",
        deviceId: this.#deviceId,
        signature: bytesToHex(signature),
      }),
    );
  }

  #fail(error: Error): void {
    this.#setState("error");
    for (const handler of this.#errorHandlers) {
      handler(error);
    }
  }

  #setState(state: AuthorizedPresenceConnectionState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const handler of this.#stateHandlers) {
      handler(state);
    }
  }
}

type PresenceChallengeMessage = {
  type: "presence-challenge";
  challenge: string;
  securityHead: string;
};

type PresenceStateMessage = {
  type: "presence-state";
  deviceIds: string[];
};

type ReconnectSessionMessage = {
  type: "reconnect-session";
  fromDeviceId: string;
  sessionId: string;
  transportMode?: ReconnectTransportMode;
};

function isChallengeMessage(value: unknown): value is PresenceChallengeMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "presence-challenge" &&
    "challenge" in value &&
    typeof value.challenge === "string" &&
    "securityHead" in value &&
    typeof value.securityHead === "string"
  );
}

function isPresenceStateMessage(
  value: unknown,
): value is PresenceStateMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "presence-state" &&
    "deviceIds" in value &&
    Array.isArray(value.deviceIds) &&
    value.deviceIds.every((deviceId) => typeof deviceId === "string")
  );
}

function isReconnectSessionMessage(
  value: unknown,
): value is ReconnectSessionMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "reconnect-session" &&
    "fromDeviceId" in value &&
    typeof value.fromDeviceId === "string" &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    (!("transportMode" in value) ||
      value.transportMode === undefined ||
      value.transportMode === "direct" ||
      value.transportMode === "relay")
  );
}

function createPresenceWebSocketUrl(
  coordinatorBaseUrl: string,
  projectId: ProjectId,
): URL {
  const url = new URL(coordinatorBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/projects/${projectId}/presence`;
  url.search = "";
  url.hash = "";
  return url;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(
  value: string,
  expectedBytes: number,
  label: string,
): Uint8Array {
  if (
    value.length !== expectedBytes * 2 ||
    !/^[0-9a-f]+$/i.test(value)
  ) {
    throw new TypeError(`${label} must be ${expectedBytes} bytes of hex`);
  }

  const result = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
