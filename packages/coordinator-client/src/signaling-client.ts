import type { WorkspaceId } from "@floe-note/domain";

import {
  decodeServerMessage,
  encodeSignal,
  type CoordinatorServerMessage,
  type WebRtcSignal,
} from "./protocol.js";
import type { SessionId } from "./session-id.js";

export type SignalingConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export type SignalingDebugEvent = {
  at: string;
  event: string;
  details: Record<string, unknown>;
};

export type SignalingDebugLogger = (event: SignalingDebugEvent) => void;

const SIGNALING_RECONNECT_DELAYS_MS = [
  1_000,
  2_000,
  4_000,
  8_000,
  16_000,
  30_000,
] as const;

export class CoordinatorSignalingClient {
  readonly #url: URL;
  readonly #messageHandlers = new Set<
    (message: CoordinatorServerMessage) => void
  >();
  readonly #stateHandlers = new Set<
    (state: SignalingConnectionState) => void
  >();
  readonly #debugLogger: SignalingDebugLogger | null;
  #socket: WebSocket | null = null;
  #state: SignalingConnectionState = "idle";
  #started = false;
  #generation = 0;
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    coordinatorBaseUrl: string,
    projectId: WorkspaceId,
    sessionId: SessionId,
    debugLogger: SignalingDebugLogger | null = null,
  ) {
    this.#url = createWebSocketUrl(coordinatorBaseUrl, projectId, sessionId);
    this.#debugLogger = debugLogger;
  }

  get state(): SignalingConnectionState {
    return this.#state;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#connect();
  }

  sendSignal(signal: WebRtcSignal): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Coordinator WebSocket is not open");
    }

    this.#debug("signal.send", {
      type: signal.type,
    });
    this.#socket.send(encodeSignal(signal));
  }

  onMessage(
    handler: (message: CoordinatorServerMessage) => void,
  ): () => void {
    this.#messageHandlers.add(handler);
    return () => this.#messageHandlers.delete(handler);
  }

  onStateChange(
    handler: (state: SignalingConnectionState) => void,
  ): () => void {
    this.#stateHandlers.add(handler);
    handler(this.#state);
    return () => this.#stateHandlers.delete(handler);
  }

  close(): void {
    if (!this.#started && !this.#socket && !this.#reconnectTimer) return;

    this.#debug("socket.close-requested");

    this.#started = false;
    this.#generation += 1;
    this.#clearReconnectTimer();
    this.#socket?.close(1000, "Signaling session ended");
    this.#socket = null;
    this.#reconnectAttempt = 0;
    this.#setState("closed");
    this.#messageHandlers.clear();
    this.#stateHandlers.clear();
  }

  #connect(): void {
    if (!this.#started || this.#socket) return;

    this.#generation += 1;
    const generation = this.#generation;
    this.#setState("connecting");
    this.#debug("socket.connect", {
      origin: this.#url.origin,
    });

    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    socket.addEventListener("open", () => {
      if (generation !== this.#generation || socket !== this.#socket) return;

      this.#debug("socket.open");
      this.#reconnectAttempt = 0;
      this.#setState("open");
    });

    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (generation !== this.#generation || socket !== this.#socket) return;

      if (typeof event.data !== "string") {
        this.#debug("socket.message-ignored", {
          dataType: typeof event.data,
        });
        return;
      }

      try {
        const message = decodeServerMessage(event.data);
        this.#debug("socket.message", {
          type: message.type,
          signalType: message.type === "signal" ? message.signal.type : null,
        });

        for (const handler of this.#messageHandlers) {
          handler(message);
        }
      } catch (error) {
        this.#debug("socket.message-error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    socket.addEventListener("close", (event) => {
      if (generation !== this.#generation || socket !== this.#socket) return;

      this.#debug("socket.close", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      this.#socket = null;

      if (!this.#started) {
        this.#setState("closed");
        return;
      }

      if (!isRetryableCloseCode(event.code)) {
        this.#setState("closed");
        return;
      }

      this.#setState("closed");
      this.#scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (generation !== this.#generation || socket !== this.#socket) return;

      this.#debug("socket.error");
      this.#setState("error");
    });
  }

  #scheduleReconnect(): void {
    if (!this.#started || this.#reconnectTimer) return;

    const delayIndex = Math.min(
      this.#reconnectAttempt,
      SIGNALING_RECONNECT_DELAYS_MS.length - 1,
    );
    const delayMs = SIGNALING_RECONNECT_DELAYS_MS[delayIndex];
    this.#reconnectAttempt += 1;

    this.#debug("socket.reconnect-scheduled", {
      delayMs,
    });

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (!this.#started || this.#socket) return;

      this.#debug("socket.reconnect-start");
      this.#connect();
    }, delayMs);
  }

  #clearReconnectTimer(): void {
    if (!this.#reconnectTimer) return;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }

  #setState(state: SignalingConnectionState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const handler of this.#stateHandlers) {
      handler(state);
    }
  }

  #debug(event: string, details: Record<string, unknown> = {}): void {
    this.#debugLogger?.({
      at: new Date().toISOString(),
      event,
      details,
    });
  }
}

function isRetryableCloseCode(code: number): boolean {
  return (
    code === 1001 ||
    code === 1006 ||
    code === 1011 ||
    code === 1012 ||
    code === 1013
  );
}

function createWebSocketUrl(
  coordinatorBaseUrl: string,
  projectId: WorkspaceId,
  sessionId: SessionId,
): URL {
  const url = new URL(coordinatorBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/projects/${projectId}/sessions/${sessionId}`;
  url.search = "";
  url.hash = "";
  return url;
}
