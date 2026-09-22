import type { ProjectId } from "@floe-note/domain";

import type { Transport } from "./transport.js";

const DATA_CHANNEL_PREFIX = "floe-note:v1:";
const ICE_GATHERING_TIMEOUT_MS = 15_000;

export type WebRtcConnectionState = RTCPeerConnectionState;

export class WebRtcTransport implements Transport {
  readonly #projectId: ProjectId;
  readonly #peerConnection: RTCPeerConnection;
  readonly #messageHandlers = new Set<(data: Uint8Array) => void>();
  readonly #stateHandlers = new Set<(state: WebRtcConnectionState) => void>();
  readonly #pendingMessages: ArrayBuffer[] = [];
  #dataChannel: RTCDataChannel | null = null;

  constructor(projectId: ProjectId) {
    this.#projectId = projectId;
    this.#peerConnection = new RTCPeerConnection();

    this.#peerConnection.addEventListener("datachannel", (event) => {
      if (event.channel.label !== this.#dataChannelLabel) {
        event.channel.close();
        return;
      }

      this.#attachDataChannel(event.channel);
    });

    this.#peerConnection.addEventListener("connectionstatechange", () => {
      this.#emitConnectionState();
    });
  }

  get connectionState(): WebRtcConnectionState {
    return this.#peerConnection.connectionState;
  }

  async createOffer(): Promise<string> {
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
    const offer = parseDescription(serializedOffer, "offer");
    await this.#peerConnection.setRemoteDescription(offer);

    const answer = await this.#peerConnection.createAnswer();
    await this.#peerConnection.setLocalDescription(answer);
    await waitForIceGatheringComplete(this.#peerConnection);

    return serializeDescription(this.#peerConnection.localDescription);
  }

  async acceptAnswer(serializedAnswer: string): Promise<void> {
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

  close(): void {
    this.#dataChannel?.close();
    this.#peerConnection.close();
    this.#pendingMessages.length = 0;
    this.#messageHandlers.clear();
    this.#stateHandlers.clear();
  }

  get #dataChannelLabel(): string {
    return `${DATA_CHANNEL_PREFIX}${this.#projectId}`;
  }

  #attachDataChannel(channel: RTCDataChannel): void {
    if (this.#dataChannel && this.#dataChannel !== channel) {
      channel.close();
      return;
    }

    this.#dataChannel = channel;
    channel.binaryType = "arraybuffer";

    channel.addEventListener("open", () => {
      for (const payload of this.#pendingMessages.splice(0)) {
        channel.send(payload);
      }
    });

    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!(event.data instanceof ArrayBuffer)) return;

      const data = new Uint8Array(event.data);
      for (const handler of this.#messageHandlers) {
        handler(data);
      }
    });
  }

  #emitConnectionState(): void {
    const state = this.connectionState;
    for (const handler of this.#stateHandlers) {
      handler(state);
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
