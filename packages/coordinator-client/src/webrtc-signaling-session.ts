import type { ProjectId } from "@floe-note/domain";
import { WebRtcTransport } from "@floe-note/transport/webrtc";

import {
  CoordinatorSignalingClient,
  type SignalingConnectionState,
  type SignalingDebugLogger,
} from "./signaling-client.js";
import type { CoordinatorServerMessage, WebRtcSignal } from "./protocol.js";
import type { SessionId } from "./session-id.js";

export type WebRtcSignalingRole = "host" | "join";

export type WebRtcSignalingSessionOptions = {
  role: WebRtcSignalingRole;
  coordinatorBaseUrl: string;
  projectId: ProjectId;
  sessionId: SessionId;
  transport: WebRtcTransport;
  debugLogger?: SignalingDebugLogger;
};

export class WebRtcSignalingSession {
  readonly #role: WebRtcSignalingRole;
  readonly #transport: WebRtcTransport;
  readonly #client: CoordinatorSignalingClient;
  #stopMessage: (() => void) | null = null;
  #stopCandidate: (() => void) | null = null;
  #incomingQueue: Promise<void> = Promise.resolve();
  #offerSent = false;
  #started = false;

  constructor(options: WebRtcSignalingSessionOptions) {
    this.#role = options.role;
    this.#transport = options.transport;
    this.#client = new CoordinatorSignalingClient(
      options.coordinatorBaseUrl,
      options.projectId,
      options.sessionId,
      options.debugLogger ?? null,
    );
  }

  get connectionState(): SignalingConnectionState {
    return this.#client.state;
  }

  onConnectionStateChange(
    handler: (state: SignalingConnectionState) => void,
  ): () => void {
    return this.#client.onStateChange(handler);
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;

    this.#stopCandidate = this.#transport.onIceCandidate((candidate) => {
      this.#client.sendSignal({
        type: "ice-candidate",
        candidate,
      });
    });

    this.#stopMessage = this.#client.onMessage((message) => {
      this.#incomingQueue = this.#incomingQueue
        .then(() => this.#handleMessage(message))
        .catch(() => undefined);
    });

    this.#client.start();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;

    this.#stopMessage?.();
    this.#stopCandidate?.();
    this.#stopMessage = null;
    this.#stopCandidate = null;
    this.#client.close();
  }

  async #handleMessage(message: CoordinatorServerMessage): Promise<void> {
    if (message.type === "peer-ready") {
      if (this.#role === "host" && !this.#offerSent) {
        this.#offerSent = true;
        const description = await this.#transport.createTrickleOffer();
        this.#client.sendSignal({
          type: "offer",
          description,
        });
      }
      return;
    }

    if (message.type === "peer-left") {
      return;
    }

    await this.#handleSignal(message.signal);
  }

  async #handleSignal(signal: WebRtcSignal): Promise<void> {
    switch (signal.type) {
      case "offer": {
        if (this.#role !== "join") return;

        const description = await this.#transport.acceptTrickleOffer(
          signal.description,
        );
        this.#client.sendSignal({
          type: "answer",
          description,
        });
        return;
      }

      case "answer":
        if (this.#role === "host") {
          await this.#transport.acceptTrickleAnswer(signal.description);
        }
        return;

      case "ice-candidate":
        await this.#transport.addIceCandidate(signal.candidate);
        return;
    }
  }
}
