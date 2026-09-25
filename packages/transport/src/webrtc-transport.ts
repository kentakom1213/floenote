import type { ProjectId } from "@floe-note/domain";

import type { Transport } from "./transport.js";

const DATA_CHANNEL_PREFIX = "floe-note:v1:";
const ICE_GATHERING_TIMEOUT_MS = 60_000;
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
];

export type WebRtcConnectionState = RTCPeerConnectionState;
export type WebRtcDataChannelState = RTCDataChannelState | "none";

export type WebRtcStatus = {
  connectionState: WebRtcConnectionState;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  dataChannelState: WebRtcDataChannelState;
  gatheredCandidateCount: number;
  warning: string | null;
  error: string | null;
};

export type WebRtcDebugEvent = {
  at: string;
  instanceId: string;
  event: string;
  details: Record<string, unknown>;
};

export type WebRtcDebugLogger = (event: WebRtcDebugEvent) => void;

export class WebRtcTransport implements Transport {
  readonly #projectId: ProjectId;
  readonly #peerConnection: RTCPeerConnection;
  readonly #messageHandlers = new Set<(data: Uint8Array) => void>();
  readonly #stateHandlers = new Set<(state: WebRtcConnectionState) => void>();
  readonly #statusHandlers = new Set<(status: WebRtcStatus) => void>();
  readonly #iceCandidateHandlers = new Set<
    (candidate: RTCIceCandidateInit | null) => void
  >();
  readonly #pendingMessages: ArrayBuffer[] = [];
  readonly #pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  readonly #debugLogger: WebRtcDebugLogger | null;
  readonly #instanceId = crypto.randomUUID().slice(0, 8);
  #dataChannel: RTCDataChannel | null = null;
  #gatheredCandidateCount = 0;
  #warning: string | null = null;
  #error: string | null = null;

  constructor(
    projectId: ProjectId,
    configuration: RTCConfiguration = { iceServers: DEFAULT_ICE_SERVERS },
    debugLogger: WebRtcDebugLogger | null = null,
  ) {
    this.#projectId = projectId;
    this.#debugLogger = debugLogger;
    this.#peerConnection = new RTCPeerConnection(configuration);

    this.#debug("transport.created", {
      iceServerCount: configuration.iceServers?.length ?? 0,
    });

    this.#peerConnection.addEventListener("signalingstatechange", () => {
      this.#debug("peer.signaling-state", {
        state: this.#peerConnection.signalingState,
      });
    });

    this.#peerConnection.addEventListener("datachannel", (event) => {
      const matchesProject = event.channel.label === this.#dataChannelLabel;

      this.#debug("data-channel.received", {
        matchesProject,
        ordered: event.channel.ordered,
        readyState: event.channel.readyState,
      });

      if (!matchesProject) {
        this.#error =
          "Project mismatch: the remote WebRTC channel belongs to a different Project.";
        event.channel.close();
        this.#emitStatus();
        return;
      }

      this.#attachDataChannel(event.channel);
    });

    this.#peerConnection.addEventListener("connectionstatechange", () => {
      this.#debug("peer.connection-state", {
        state: this.#peerConnection.connectionState,
      });
      this.#emitConnectionState();
      this.#emitStatus();
    });

    this.#peerConnection.addEventListener("iceconnectionstatechange", () => {
      this.#debug("ice.connection-state", {
        state: this.#peerConnection.iceConnectionState,
      });
      this.#emitStatus();
    });

    this.#peerConnection.addEventListener("icegatheringstatechange", () => {
      this.#debug("ice.gathering-state", {
        state: this.#peerConnection.iceGatheringState,
        candidates: this.#gatheredCandidateCount,
      });
      this.#emitStatus();
    });

    this.#peerConnection.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        this.#gatheredCandidateCount += 1;
        this.#debug("ice.candidate", {
          index: this.#gatheredCandidateCount,
          candidateType: event.candidate.type,
          protocol: event.candidate.protocol,
          tcpType: event.candidate.tcpType,
        });
      } else {
        this.#debug("ice.candidate-end", {
          candidates: this.#gatheredCandidateCount,
        });
      }

      const candidate = event.candidate?.toJSON() ?? null;
      for (const handler of this.#iceCandidateHandlers) {
        handler(candidate);
      }

      this.#emitStatus();
    });

    this.#peerConnection.addEventListener("icecandidateerror", (event) => {
      this.#warning =
        event.errorText || "An ICE server could not provide a candidate.";
      this.#debug("ice.candidate-error", {
        url: event.url,
        errorCode: event.errorCode,
        errorText: event.errorText,
      });
      this.#emitStatus();
    });
  }

  get connectionState(): WebRtcConnectionState {
    return this.#peerConnection.connectionState;
  }

  get dataChannelState(): WebRtcDataChannelState {
    return this.#dataChannel?.readyState ?? "none";
  }

  get signalingState(): RTCSignalingState {
    return this.#peerConnection.signalingState;
  }

  get status(): WebRtcStatus {
    return {
      connectionState: this.connectionState,
      iceConnectionState: this.#peerConnection.iceConnectionState,
      iceGatheringState: this.#peerConnection.iceGatheringState,
      dataChannelState: this.dataChannelState,
      gatheredCandidateCount: this.#gatheredCandidateCount,
      warning: this.#warning,
      error: this.#error,
    };
  }

  async createOffer(): Promise<string> {
    this.#clearDiagnostics();
    this.#debug("offer.create-start");

    if (!this.#dataChannel) {
      this.#attachDataChannel(
        this.#peerConnection.createDataChannel(this.#dataChannelLabel, {
          ordered: true,
        }),
      );
    }

    const offer = await this.#peerConnection.createOffer();
    await this.#peerConnection.setLocalDescription(offer);
    this.#debug("offer.local-description-set");
    await this.#finishIceGatheringForManualSdp();
    this.#debug("offer.ready", {
      candidates: this.#gatheredCandidateCount,
    });

    return serializeDescription(this.#peerConnection.localDescription);
  }

  async acceptOffer(serializedOffer: string): Promise<string> {
    this.#clearDiagnostics();
    this.#debug("offer.accept-start", {
      bytes: serializedOffer.length,
    });

    const offer = parseDescription(serializedOffer, "offer");
    await this.#peerConnection.setRemoteDescription(offer);
    this.#debug("offer.remote-description-set");

    const answer = await this.#peerConnection.createAnswer();
    await this.#peerConnection.setLocalDescription(answer);
    this.#debug("answer.local-description-set");
    await this.#finishIceGatheringForManualSdp();
    this.#debug("answer.ready", {
      candidates: this.#gatheredCandidateCount,
    });

    return serializeDescription(this.#peerConnection.localDescription);
  }

  async acceptAnswer(serializedAnswer: string): Promise<void> {
    this.#clearDiagnostics();
    this.#debug("answer.accept-start", {
      bytes: serializedAnswer.length,
    });

    const answer = parseDescription(serializedAnswer, "answer");
    await this.#peerConnection.setRemoteDescription(answer);
    await this.#flushPendingRemoteCandidates();
    this.#debug("answer.remote-description-set");
  }

  async createTrickleOffer(): Promise<RTCSessionDescriptionInit> {
    this.#clearDiagnostics();
    this.#debug("trickle.offer.create-start");

    if (!this.#dataChannel) {
      this.#attachDataChannel(
        this.#peerConnection.createDataChannel(this.#dataChannelLabel, {
          ordered: true,
        }),
      );
    }

    const offer = await this.#peerConnection.createOffer();
    await this.#peerConnection.setLocalDescription(offer);
    this.#debug("trickle.offer.local-description-set");

    return descriptionToInit(this.#peerConnection.localDescription);
  }

  async createTrickleIceRestartOffer(): Promise<RTCSessionDescriptionInit> {
    this.#clearDiagnostics();
    this.#debug("trickle.ice-restart.create-start");

    if (this.#peerConnection.signalingState === "have-local-offer") {
      this.#debug("trickle.ice-restart.rollback-pending-offer");
      await this.#peerConnection.setLocalDescription({ type: "rollback" });
    }

    if (this.#peerConnection.signalingState !== "stable") {
      throw new Error(
        `Cannot restart ICE while signaling state is ${this.#peerConnection.signalingState}`,
      );
    }

    if (!this.#dataChannel || this.#dataChannel.readyState === "closed") {
      throw new Error("Cannot restart ICE without an active DataChannel");
    }

    const offer = await this.#peerConnection.createOffer({
      iceRestart: true,
    });
    await this.#peerConnection.setLocalDescription(offer);
    this.#debug("trickle.ice-restart.local-description-set");

    return descriptionToInit(this.#peerConnection.localDescription);
  }

  async acceptTrickleOffer(
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit> {
    this.#clearDiagnostics();
    this.#debug("trickle.offer.accept-start");

    await this.#peerConnection.setRemoteDescription(offer);
    await this.#flushPendingRemoteCandidates();
    this.#debug("trickle.offer.remote-description-set");

    const answer = await this.#peerConnection.createAnswer();
    await this.#peerConnection.setLocalDescription(answer);
    this.#debug("trickle.answer.local-description-set");

    return descriptionToInit(this.#peerConnection.localDescription);
  }

  async acceptTrickleAnswer(
    answer: RTCSessionDescriptionInit,
  ): Promise<void> {
    this.#debug("trickle.answer.accept-start");
    await this.#peerConnection.setRemoteDescription(answer);
    await this.#flushPendingRemoteCandidates();
    this.#debug("trickle.answer.remote-description-set");
  }

  async addIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (!candidate) {
      this.#debug("trickle.remote-candidate-end");
      return;
    }

    if (!this.#peerConnection.remoteDescription) {
      this.#pendingRemoteCandidates.push(candidate);
      this.#debug("trickle.remote-candidate-queued", {
        queueLength: this.#pendingRemoteCandidates.length,
      });
      return;
    }

    await this.#peerConnection.addIceCandidate(candidate);
    this.#debug("trickle.remote-candidate-added");
  }

  onIceCandidate(
    handler: (candidate: RTCIceCandidateInit | null) => void,
  ): () => void {
    this.#iceCandidateHandlers.add(handler);
    return () => this.#iceCandidateHandlers.delete(handler);
  }

  send(data: Uint8Array): void {
    const payload = data.slice().buffer;

    if (this.#dataChannel?.readyState === "open") {
      const bufferedAmountBefore = this.#dataChannel.bufferedAmount;
      this.#dataChannel.send(payload);
      this.#debug("data-channel.send", {
        bytes: data.byteLength,
        bufferedAmountBefore,
        bufferedAmountAfter: this.#dataChannel.bufferedAmount,
      });
      return;
    }

    this.#pendingMessages.push(payload);
    this.#debug("data-channel.queue", {
      bytes: data.byteLength,
      queueLength: this.#pendingMessages.length,
      readyState: this.dataChannelState,
    });
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
    this.#debug("transport.close", {
      connectionState: this.connectionState,
      iceConnectionState: this.#peerConnection.iceConnectionState,
      dataChannelState: this.dataChannelState,
      queuedMessages: this.#pendingMessages.length,
    });

    this.#dataChannel?.close();
    this.#peerConnection.close();
    this.#pendingMessages.length = 0;
    this.#pendingRemoteCandidates.length = 0;
    this.#messageHandlers.clear();
    this.#stateHandlers.clear();
    this.#statusHandlers.clear();
    this.#iceCandidateHandlers.clear();
  }

  get #dataChannelLabel(): string {
    return `${DATA_CHANNEL_PREFIX}${this.#projectId}`;
  }

  async #finishIceGatheringForManualSdp(): Promise<void> {
    this.#debug("ice.wait-complete-start", {
      state: this.#peerConnection.iceGatheringState,
    });

    const completed = await waitForIceGatheringComplete(
      this.#peerConnection,
      ICE_GATHERING_TIMEOUT_MS,
    );

    if (completed) {
      this.#debug("ice.wait-complete-done", {
        candidates: this.#gatheredCandidateCount,
      });
      return;
    }

    this.#debug("ice.wait-complete-timeout", {
      candidates: this.#gatheredCandidateCount,
    });

    throw new Error(
      this.#gatheredCandidateCount > 0
        ? `ICE gathering did not complete within 60 seconds after collecting ${this.#gatheredCandidateCount} candidate(s). Manual SDP exchange requires complete ICE gathering.`
        : "ICE gathering did not complete within 60 seconds and no candidate was gathered.",
    );
  }

  async #flushPendingRemoteCandidates(): Promise<void> {
    for (const candidate of this.#pendingRemoteCandidates.splice(0)) {
      await this.#peerConnection.addIceCandidate(candidate);
      this.#debug("trickle.remote-candidate-added", {
        fromQueue: true,
      });
    }
  }

  #attachDataChannel(channel: RTCDataChannel): void {
    if (this.#dataChannel && this.#dataChannel !== channel) {
      this.#error = "A WebRTC DataChannel is already attached.";
      this.#debug("data-channel.reject-extra", {
        currentState: this.#dataChannel.readyState,
        incomingState: channel.readyState,
      });
      channel.close();
      this.#emitStatus();
      return;
    }

    this.#dataChannel = channel;
    channel.binaryType = "arraybuffer";

    this.#debug("data-channel.attach", {
      ordered: channel.ordered,
      readyState: channel.readyState,
      negotiated: channel.negotiated,
      id: channel.id,
    });

    this.#emitStatus();

    channel.addEventListener("open", () => {
      this.#error = null;
      const queuedMessages = this.#pendingMessages.length;

      this.#debug("data-channel.open", {
        queuedMessages,
        bufferedAmount: channel.bufferedAmount,
      });

      for (const payload of this.#pendingMessages.splice(0)) {
        channel.send(payload);
        this.#debug("data-channel.flush", {
          bytes: payload.byteLength,
          bufferedAmount: channel.bufferedAmount,
        });
      }

      this.#emitStatus();
    });

    channel.addEventListener("close", () => {
      this.#debug("data-channel.close", {
        connectionState: this.connectionState,
        iceConnectionState: this.#peerConnection.iceConnectionState,
        bufferedAmount: channel.bufferedAmount,
      });
      this.#emitStatus();
    });

    channel.addEventListener("error", () => {
      this.#error =
        this.#peerConnection.iceConnectionState === "failed"
          ? "The WebRTC DataChannel failed because ICE connectivity failed."
          : "The WebRTC DataChannel reported an error.";

      this.#debug("data-channel.error", {
        readyState: channel.readyState,
        connectionState: this.connectionState,
        iceConnectionState: this.#peerConnection.iceConnectionState,
        signalingState: this.#peerConnection.signalingState,
        bufferedAmount: channel.bufferedAmount,
        queuedMessages: this.#pendingMessages.length,
      });

      this.#emitStatus();
    });

    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!(event.data instanceof ArrayBuffer)) {
        this.#debug("data-channel.message-ignored", {
          dataType: typeof event.data,
        });
        return;
      }

      const data = new Uint8Array(event.data);
      this.#debug("data-channel.message", {
        bytes: data.byteLength,
      });

      for (const handler of this.#messageHandlers) {
        handler(data);
      }
    });

    channel.addEventListener("bufferedamountlow", () => {
      this.#debug("data-channel.buffered-amount-low", {
        bufferedAmount: channel.bufferedAmount,
      });
    });
  }

  #clearDiagnostics(): void {
    this.#warning = null;
    this.#error = null;
    this.#gatheredCandidateCount = 0;
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

  #debug(event: string, details: Record<string, unknown> = {}): void {
    this.#debugLogger?.({
      at: new Date().toISOString(),
      instanceId: this.#instanceId,
      event,
      details,
    });
  }
}

function descriptionToInit(
  description: RTCSessionDescription | null,
): RTCSessionDescriptionInit {
  if (!description) {
    throw new Error("Local WebRTC description is not available");
  }

  return description.toJSON();
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
  timeoutMs: number,
): Promise<boolean> {
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const handleStateChange = () => {
      if (peerConnection.iceGatheringState !== "complete") return;
      cleanup();
      resolve(true);
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
