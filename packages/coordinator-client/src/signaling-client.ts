import type { ProjectId } from "@floe-note/domain";

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

  constructor(
    coordinatorBaseUrl: string,
    projectId: ProjectId,
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
    if (this.#socket) return;

    this.#setState("connecting");
    this.#debug("socket.connect", {
      origin: this.#url.origin,
    });

    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    socket.addEventListener("open", () => {
      this.#debug("socket.open");
      this.#setState("open");
    });

    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
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
      this.#debug("socket.close", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      this.#socket = null;
      this.#setState("closed");
    });

    socket.addEventListener("error", () => {
      this.#debug("socket.error");
      this.#setState("error");
    });
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
    this.#debug("socket.close-requested");
    this.#socket?.close(1000, "Signaling session ended");
    this.#socket = null;
    this.#setState("closed");
    this.#messageHandlers.clear();
    this.#stateHandlers.clear();
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

function createWebSocketUrl(
  coordinatorBaseUrl: string,
  projectId: ProjectId,
  sessionId: SessionId,
): URL {
  const url = new URL(coordinatorBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/projects/${projectId}/sessions/${sessionId}`;
  url.search = "";
  url.hash = "";
  return url;
}
