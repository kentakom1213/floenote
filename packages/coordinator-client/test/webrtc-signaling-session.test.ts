import { parseWorkspaceId } from "@floe-note/domain";
import type { WebRtcStatus, WebRtcTransport } from "@floe-note/transport/webrtc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseSessionId } from "../src/session-id.js";
import { WebRtcSignalingSession } from "../src/webrtc-signaling-session.js";

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  readonly sent: string[] = [];
  readonly #handlers = new Map<string, Set<(event: { data?: string }) => void>>();

  constructor(_url: string | URL) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    const handlers = this.#handlers.get(type) ?? new Set();
    handlers.add(handler);
    this.#handlers.set(type, handlers);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.#emit("open", {});
  }

  receive(message: object): void {
    this.#emit("message", { data: JSON.stringify(message) });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  #emit(type: string, event: { data?: string }): void {
    for (const handler of this.#handlers.get(type) ?? []) handler(event);
  }
}

class FakeTransport {
  connectionState: RTCPeerConnectionState = "connecting";
  iceConnectionState: RTCIceConnectionState = "checking";
  restartCount = 0;
  readonly #statusHandlers = new Set<(status: WebRtcStatus) => void>();

  onIceCandidate(_handler: (candidate: RTCIceCandidateInit | null) => void): () => void {
    return () => {};
  }

  onStatusChange(handler: (status: WebRtcStatus) => void): () => void {
    this.#statusHandlers.add(handler);
    handler(this.status);
    return () => this.#statusHandlers.delete(handler);
  }

  get status(): WebRtcStatus {
    return {
      connectionState: this.connectionState,
      iceConnectionState: this.iceConnectionState,
      iceGatheringState: "complete",
      dataChannelState: "connecting",
      gatheredCandidateCount: 2,
      warning: null,
      error: null,
    };
  }

  setIceState(state: RTCIceConnectionState): void {
    this.iceConnectionState = state;
    for (const handler of this.#statusHandlers) handler(this.status);
  }

  setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    for (const handler of this.#statusHandlers) handler(this.status);
  }

  async createTrickleOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "v=0" };
  }

  async createTrickleIceRestartOffer(): Promise<RTCSessionDescriptionInit> {
    this.restartCount += 1;
    return { type: "offer", sdp: "v=0" };
  }
}

describe("WebRtcSignalingSession invitation ICE retry", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function createHost() {
    const transport = new FakeTransport();
    const session = new WebRtcSignalingSession({
      role: "host",
      coordinatorBaseUrl: "https://coordinator.example",
      workspaceId: parseWorkspaceId("00000000-0000-7000-8000-000000000010"),
      sessionId: parseSessionId("00000000000070008000000000000020"),
      transport: transport as unknown as WebRtcTransport,
      iceRestartRetryDelaysMs: [5_000, 5_000],
    });
    session.start();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: "peer-ready" });
    return { session, socket, transport };
  }

  it("does not interrupt an initial ICE connectivity check after five seconds", async () => {
    const { session, socket, transport } = createHost();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(socket.sent.some((raw) => JSON.parse(raw).signal?.type === "offer")).toBe(true);
    expect(transport.restartCount).toBe(0);

    transport.setIceState("failed");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(transport.restartCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.restartCount).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(transport.restartCount).toBe(1);
    session.stop();
  });

  it("cancels a scheduled restart when connectivity succeeds", async () => {
    const { session, transport } = createHost();
    await vi.advanceTimersByTimeAsync(0);
    transport.setIceState("failed");
    await vi.advanceTimersByTimeAsync(2_000);
    transport.setConnectionState("connected");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(transport.restartCount).toBe(0);
    session.stop();
  });
});
