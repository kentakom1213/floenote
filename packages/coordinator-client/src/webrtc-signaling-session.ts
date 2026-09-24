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
  iceRestartRetryDelaysMs?: readonly number[];
};

export class WebRtcSignalingSession {
  readonly #role: WebRtcSignalingRole;
  readonly #transport: WebRtcTransport;
  readonly #client: CoordinatorSignalingClient;
  readonly #debugLogger: SignalingDebugLogger | null;
  readonly #iceRestartRetryDelaysMs: readonly number[];
  #stopMessage: (() => void) | null = null;
  #stopCandidate: (() => void) | null = null;
  #stopConnectionState: (() => void) | null = null;
  #incomingQueue: Promise<void> = Promise.resolve();
  #offerSent = false;
  #started = false;
  #iceRestartAttempt = 0;
  #iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  #bufferOutgoingCandidates = false;
  readonly #pendingOutgoingCandidates: Array<RTCIceCandidateInit | null> = [];

  constructor(options: WebRtcSignalingSessionOptions) {
    this.#role = options.role;
    this.#transport = options.transport;
    this.#debugLogger = options.debugLogger ?? null;
    this.#iceRestartRetryDelaysMs = [
      ...(options.iceRestartRetryDelaysMs ?? []),
    ];
    this.#client = new CoordinatorSignalingClient(
      options.coordinatorBaseUrl,
      options.projectId,
      options.sessionId,
      this.#debugLogger,
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
      if (this.#bufferOutgoingCandidates) {
        this.#pendingOutgoingCandidates.push(candidate);
        return;
      }

      this.#sendIceCandidate(candidate);
    });

    if (this.#role === "host" && this.#iceRestartRetryDelaysMs.length > 0) {
      this.#stopConnectionState = this.#transport.onConnectionStateChange(
        (state) => {
          if (state === "connected" || state === "closed") {
            this.#clearIceRestartTimer();
          }
        },
      );
    }

    this.#stopMessage = this.#client.onMessage((message) => {
      this.#incomingQueue = this.#incomingQueue
        .then(() => this.#handleMessage(message))
        .catch((error: unknown) => {
          this.#debug("message.handle-error", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });

    this.#client.start();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;

    this.#clearIceRestartTimer();
    this.#stopMessage?.();
    this.#stopCandidate?.();
    this.#stopConnectionState?.();
    this.#stopMessage = null;
    this.#stopCandidate = null;
    this.#stopConnectionState = null;
    this.#bufferOutgoingCandidates = false;
    this.#pendingOutgoingCandidates.length = 0;
    this.#client.close();
  }

  async #handleMessage(message: CoordinatorServerMessage): Promise<void> {
    if (message.type === "peer-ready") {
      if (this.#role !== "host") return;

      if (
        this.#transport.connectionState === "connected" ||
        this.#transport.connectionState === "closed"
      ) {
        return;
      }

      this.#clearIceRestartTimer();

      if (!this.#offerSent) {
        this.#offerSent = true;
        await this.#sendHostOffer(false);
      } else {
        await this.#sendHostOffer(true);
      }

      this.#scheduleIceRestart();
      return;
    }

    if (message.type === "peer-left") {
      this.#clearIceRestartTimer();
      return;
    }

    await this.#handleSignal(message.signal);
  }

  async #handleSignal(signal: WebRtcSignal): Promise<void> {
    switch (signal.type) {
      case "offer": {
        if (this.#role !== "join") return;

        await this.#withBufferedOutgoingCandidates(async () => {
          const description = await this.#transport.acceptTrickleOffer(
            signal.description,
          );
          this.#client.sendSignal({
            type: "answer",
            description,
          });
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

  async #sendHostOffer(iceRestart: boolean): Promise<void> {
    await this.#withBufferedOutgoingCandidates(async () => {
      const description = iceRestart
        ? await this.#transport.createTrickleIceRestartOffer()
        : await this.#transport.createTrickleOffer();

      this.#client.sendSignal({
        type: "offer",
        description,
      });
    });
  }

  #scheduleIceRestart(): void {
    this.#clearIceRestartTimer();

    if (
      !this.#started ||
      this.#role !== "host" ||
      this.#transport.connectionState === "connected" ||
      this.#transport.connectionState === "closed"
    ) {
      return;
    }

    const delayMs =
      this.#iceRestartRetryDelaysMs[this.#iceRestartAttempt];
    if (delayMs === undefined) {
      this.#debug("ice-restart.exhausted", {
        attempts: this.#iceRestartAttempt,
      });
      return;
    }

    const attempt = this.#iceRestartAttempt + 1;
    this.#debug("ice-restart.scheduled", {
      attempt,
      delayMs,
    });

    this.#iceRestartTimer = setTimeout(() => {
      this.#iceRestartTimer = null;
      this.#incomingQueue = this.#incomingQueue
        .then(() => this.#performIceRestart())
        .catch((error: unknown) => {
          this.#debug("ice-restart.error", {
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
          this.#scheduleIceRestart();
        });
    }, delayMs);
  }

  async #performIceRestart(): Promise<void> {
    if (
      !this.#started ||
      this.#transport.connectionState === "connected" ||
      this.#transport.connectionState === "closed"
    ) {
      return;
    }

    if (this.#client.state !== "open") {
      this.#debug("ice-restart.wait-for-signaling", {
        signalingConnectionState: this.#client.state,
        signalingState: this.#transport.signalingState,
      });
      this.#iceRestartTimer = setTimeout(() => {
        this.#iceRestartTimer = null;
        this.#incomingQueue = this.#incomingQueue
          .then(() => this.#performIceRestart())
          .catch((error: unknown) => {
            this.#debug("ice-restart.error", {
              attempt: this.#iceRestartAttempt + 1,
              error: error instanceof Error ? error.message : String(error),
            });
            this.#scheduleIceRestart();
          });
      }, 1_000);
      return;
    }

    this.#iceRestartAttempt += 1;
    const attempt = this.#iceRestartAttempt;

    this.#debug("ice-restart.start", { attempt });
    await this.#sendHostOffer(true);
    this.#debug("ice-restart.offer-sent", { attempt });
    this.#scheduleIceRestart();
  }

  async #withBufferedOutgoingCandidates(
    operation: () => Promise<void>,
  ): Promise<void> {
    this.#bufferOutgoingCandidates = true;
    let descriptionSent = false;

    try {
      await operation();
      descriptionSent = true;
    } finally {
      this.#bufferOutgoingCandidates = false;
      if (descriptionSent) {
        this.#flushOutgoingCandidates();
      } else {
        this.#pendingOutgoingCandidates.length = 0;
      }
    }
  }

  #flushOutgoingCandidates(): void {
    for (const candidate of this.#pendingOutgoingCandidates.splice(0)) {
      this.#sendIceCandidate(candidate);
    }
  }

  #sendIceCandidate(candidate: RTCIceCandidateInit | null): void {
    if (this.#client.state !== "open") return;

    this.#client.sendSignal({
      type: "ice-candidate",
      candidate,
    });
  }

  #clearIceRestartTimer(): void {
    if (!this.#iceRestartTimer) return;
    clearTimeout(this.#iceRestartTimer);
    this.#iceRestartTimer = null;
  }

  #debug(event: string, details: Record<string, unknown> = {}): void {
    this.#debugLogger?.({
      at: new Date().toISOString(),
      event,
      details,
    });
  }
}
