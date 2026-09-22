import type { ProjectId } from "@floe-note/domain";

import type { Transport } from "./transport.js";

const DATA_CHANNEL_PREFIX = "floe-note:v1:";
const ICE_GATHERING_TIMEOUT_MS = 15_000;

export type WebRtcConnectionState = RTCPeerConnectionState;
export type WebRtcDataChannelState = RTCDataChannelState | "none";

export type WebRtcStatus = {
  connectionState: WebRtcConnectionState;
  dataChannelState: WebRtcDataChannelState;
  error: string | null;
};

export class WebRtcTransport implements Transport {
  readonly #projectId: ProjectId;
  readonly #peerConnection: RTCPeerConnection;
  readonly #messageHandlers = new Set<(data: Uint8Array) => void>();
  readonly #stateHandlers = new Set<(state: WebRtcConnectionState) => void>();
  readonly #statusHandlers = new Set<(status: WebRtcStatus) => void>();
  readonly #pendingMessages: ArrayBuffer[] = [];
  #dataChannel: RTCDataChannel | null = null;
  #error: string | null = null;

  constructor(projectId: ProjectId) {
    this.#projectId = projectId;
    this.#peerConnection = new RTCPeerConnection();

    this.#peerConnection.addEventListener("datachannel", (event) => {
      if (event.channel.label !== this.#dataChannelLabel) {
        this.#error =
          "Project mismatch: the remote WebRTC channel belongs to a different Project.";
        event.channel.close();
        this.#emitStatus();
        return;
      }

      this.#attachDataChannel(event.channel);
    });

    this.#peerConnection.addEventListener("connectionstatechange", () => {
      this.#emitConnectionState();
      this.#emitStatus();
    });
  }

  get connectionState(): WebRtcConnectionState {
    return this.#peerConnection.connectionState;
  }

  get dataChannelState(): WebRtcDataChannelState {
    return this.#dataChannel?.readyState ?? "none";
  }

  get status(): WebRtcStatus {
    return {
      connectionState: this.connectionState,
      dataChannelState: this.dataChannelState,
      error: this.#error,
    };
  }

  async createOffer(): Promise<string> {
    this.#clearError();

    if (!this.#dataChannel) {
      this.#attachDataChannel(
        this.#peerConnection.createDataChannel(this.#dataChannelLabel, {
          ordered: true,
        }),
      );
    }

    const offer = await this.#peerConnection.createOffer();
    await this.#peerConnection.setLocalDescription(offer);
    await waitForIceGatheringComplete(this.#peerConnection);

    return serializeDescription(this.#peerConnection.localDescription);
  }

  async acceptOffer(serializedOffer: string): Promise<string> {
    this.#clearError();

    const offer = parseDescription(serializedOffer, "offer");
    await this.#peerConnection.setRemoteDescription(offer);

    const answer = await this.#peerConnection.createAnswer();
    await this.#peerConnection.setLocalDescription(answer);
    await waitForIceGatheringComplete(this.#peerConnection);

    return serializeDescription(this.#peerConnection.localDescription);
  }

  async acceptAnswer(serializedAnswer: string): Promise<void> {
    this.#clearError();

    const answer = parseDescription(serializedAnswer, "answer");
    await this.#peerConnection.setRemoteDescription(answer);
  }

  send(data: Uint8Array): void {
    const payload = data.slice().buffer;

    if (this.#dataChannel?.readyState === "open") {
      this.#dataChannel.send(payload);
      return;
    }

    this.#pendingMessages.push(payload);
  }

  onMessage(handler: (data: Uint8Array) => void): () => void {
    this.#messageHandlers.add(handler);
    return () => this.#messageHandlers.delete(handler);
  }

  onConnectionStateChange(
    handler: (state: WebRtcConnectionState) => void,
  ): () => void {
    this.#stateHandlers.add(handler);
    handler(this.connectionState);
    return () => this.#stateHandlers.delete(handler);
  }

  onStatusChange(handler: (status: WebRtcStatus) => void): () => void {
    this.#statusHandlers.add(handler);
    handler(this.status);
    return () => this.#statusHandlers.delete(handler);
  }

  close(): void {
    this.#dataChannel?.close();
    this.#peerConnection.close();
    this.#pendingMessages.length = 0;
    this.#messageHandlers.clear();
    this.#stateHandlers.clear();
    this.#statusHandlers.clear();
  }

  get #dataChannelLabel(): string {
    return `${DATA_CHANNEL_PREFIX}${this.#projectId}`;
  }

  #attachDataChannel(channel: RTCDataChannel): void {
    if (this.#dataChannel && this.#dataChannel !== channel) {
      this.#error = "A WebRTC DataChannel is already attached.";
      channel.close();
      this.#emitStatus();
      return;
    }

    this.#dataChannel = channel;
    channel.binaryType = "arraybuffer";
    this.#emitStatus();

    channel.addEventListener("open", () => {
      this.#clearError();

      for (const payload of this.#pendingMessages.splice(0)) {
        channel.send(payload);
      }

      this.#emitStatus();
    });

    channel.addEventListener("close", () => {
      this.#emitStatus();
    });

    channel.addEventListener("error", () => {
      this.#error = "The WebRTC DataChannel reported an error.";
      this.#emitStatus();
    });

    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!(event.data instanceof ArrayBuffer)) return;

      const data = new Uint8Array(event.data);
      for (const handler of this.#messageHandlers) {
        handler(data);
      }
    });
  }

  #clearError(): void {
    if (this.#error === null) return;
    this.#error = null;
    this.#emitStatus();
  }

  #emitConnectionState(): void {
    const state = this.connectionState;
    for (const handler of this.#stateHandlers) {
      handler(state);
    }
  }

  #emitStatus(): void {
    const status = this.status;
    for (const handler of this.#statusHandlers) {
      handler(status);
    }
  }
}

function serializeDescription(
  description: RTCSessionDescription | null,
): string {
  if (!description) {
    throw new Error("Local WebRTC description is not available");
  }

  return JSON.stringify(description.toJSON());
}

function parseDescription(
  serialized: string,
  expectedType: "offer" | "answer",
): RTCSessionDescriptionInit {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("WebRTC description must be valid JSON");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("type" in parsed) ||
    !("sdp" in parsed) ||
    parsed.type !== expectedType ||
    typeof parsed.sdp !== "string"
  ) {
    throw new Error(`Expected a WebRTC ${expectedType} description`);
  }

  return {
    type: expectedType,
    sdp: parsed.sdp,
  };
}

function waitForIceGatheringComplete(
  peerConnection: RTCPeerConnection,
): Promise<void> {
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while gathering ICE candidates"));
    }, ICE_GATHERING_TIMEOUT_MS);

    const handleStateChange = () => {
      if (peerConnection.iceGatheringState !== "complete") return;
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      peerConnection.removeEventListener(
        "icegatheringstatechange",
        handleStateChange,
      );
    };

    peerConnection.addEventListener(
      "icegatheringstatechange",
      handleStateChange,
    );
  });
}
