import {
  parseDeviceId,
  parseProjectId,
  type DeviceId,
} from "@floe-note/domain";
import { NoteProject } from "@floe-note/document";
import type { SecurityState } from "@floe-note/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  type ConnectionState = "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

  class FakeWebRtcTransport {
    static instances: FakeWebRtcTransport[] = [];

    readonly connectionHandlers = new Set<(state: ConnectionState) => void>();
    readonly statusHandlers = new Set<
      (status: { dataChannelState: "none" | "open" | "closed" }) => void
    >();
    readonly messageHandlers = new Set<(data: Uint8Array) => void>();

    constructor() {
      FakeWebRtcTransport.instances.push(this);
    }

    send(): void {}

    onMessage(handler: (data: Uint8Array) => void): () => void {
      this.messageHandlers.add(handler);
      return () => this.messageHandlers.delete(handler);
    }

    onConnectionStateChange(
      handler: (state: ConnectionState) => void,
    ): () => void {
      this.connectionHandlers.add(handler);
      handler("new");
      return () => this.connectionHandlers.delete(handler);
    }

    onStatusChange(
      handler: (
        status: { dataChannelState: "none" | "open" | "closed" },
      ) => void,
    ): () => void {
      this.statusHandlers.add(handler);
      handler({ dataChannelState: "none" });
      return () => this.statusHandlers.delete(handler);
    }

    close(): void {
      this.emit("closed");
      this.emitDataChannel("closed");
    }

    emit(state: ConnectionState): void {
      for (const handler of this.connectionHandlers) handler(state);
    }

    emitDataChannel(dataChannelState: "open" | "closed"): void {
      for (const handler of this.statusHandlers) {
        handler({ dataChannelState });
      }
    }
  }

  class FakeWebRtcSignalingSession {
    start(): void {}
    stop(): void {}
  }

  let sessionCounter = 0;

  return {
    FakeWebRtcTransport,
    FakeWebRtcSignalingSession,
    nextSessionId: () =>
      `00000000-0000-7000-8000-${String(++sessionCounter).padStart(12, "0")}`,
    reset: () => {
      FakeWebRtcTransport.instances.length = 0;
      sessionCounter = 0;
    },
  };
});

vi.mock("@floe-note/transport/webrtc", () => ({
  WebRtcTransport: harness.FakeWebRtcTransport,
}));

vi.mock("@floe-note/coordinator-client", () => ({
  createSessionId: harness.nextSessionId,
  WebRtcSignalingSession: harness.FakeWebRtcSignalingSession,
}));

import {
  AUTOMATIC_RECONNECT_CONNECTION_TIMEOUT_MS,
  AUTOMATIC_RECONNECT_DISCONNECTED_GRACE_MS,
  AUTOMATIC_RECONNECT_RETRY_DELAYS_MS,
  AutomaticPeerSyncManager,
} from "../src/AutomaticPeerSyncManager.js";

const LOCAL_DEVICE_ID = parseDeviceId(
  "00000000-0000-7000-8000-000000000001",
);
const PEER_DEVICE_ID = parseDeviceId(
  "00000000-0000-7000-8000-000000000002",
);
const PROJECT_ID = parseProjectId(
  "00000000-0000-7000-8000-000000000010",
);

type PresenceHarness = {
  sent: Array<{ peerDeviceId: DeviceId; sessionId: string }>;
  sendReconnectSession: (peerDeviceId: DeviceId, sessionId: string) => void;
};

function createPresence(): PresenceHarness {
  const sent: PresenceHarness["sent"] = [];
  return {
    sent,
    sendReconnectSession(peerDeviceId, sessionId) {
      sent.push({ peerDeviceId, sessionId });
    },
  };
}

function createSecurityState(): SecurityState {
  const device = (deviceId: DeviceId, seed: number) => ({
    deviceId,
    encryptionPublicKey: new Uint8Array(32).fill(seed),
    signingPublicKey: new Uint8Array(32).fill(seed + 1),
    addedAtSequence: 0,
  });

  return {
    protocolVersion: 1,
    projectId: PROJECT_ID,
    sequence: 0,
    headHash: new Uint8Array(32),
    keyEpoch: 1,
    devices: [
      device(LOCAL_DEVICE_ID, 1),
      device(PEER_DEVICE_ID, 10),
    ],
  };
}

function createManager(presence: PresenceHarness) {
  const project = NoteProject.create(PROJECT_ID);
  const vaultSession = {
    encryptProjectSyncPayload: async (
      _projectId: unknown,
      _keyEpoch: unknown,
      plaintext: Uint8Array,
    ) => plaintext.slice(),
    decryptProjectSyncPayload: async (
      _projectId: unknown,
      _keyEpoch: unknown,
      envelope: Uint8Array,
    ) => envelope.slice(),
  };

  return new AutomaticPeerSyncManager({
    coordinatorBaseUrl: "http://localhost:8787",
    project,
    localDeviceId: LOCAL_DEVICE_ID,
    securityState: createSecurityState(),
    vaultSession: vaultSession as never,
    presence: presence as never,
    onStatusChange: () => undefined,
  });
}

async function flushConnectionCleanup(): Promise<void> {
  await vi.runAllTicks();
}

describe("AutomaticPeerSyncManager reconnect retry", () => {
  beforeEach(() => {
    harness.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a failed initiator connection with exponential backoff", async () => {
    const presence = createPresence();
    const manager = createManager(presence);

    manager.updateOnlineDevices([LOCAL_DEVICE_ID, PEER_DEVICE_ID]);

    expect(presence.sent).toHaveLength(1);
    expect(harness.FakeWebRtcTransport.instances).toHaveLength(1);

    harness.FakeWebRtcTransport.instances[0]?.emit("failed");
    await flushConnectionCleanup();

    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_RETRY_DELAYS_MS[0] - 1,
    );
    expect(presence.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(presence.sent).toHaveLength(2);

    harness.FakeWebRtcTransport.instances[1]?.emit("failed");
    await flushConnectionCleanup();

    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_RETRY_DELAYS_MS[1] - 1,
    );
    expect(presence.sent).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(presence.sent).toHaveLength(3);

    manager.stop();
  });

  it("retries when a connection attempt never reaches a terminal state", async () => {
    const presence = createPresence();
    const manager = createManager(presence);

    manager.updateOnlineDevices([LOCAL_DEVICE_ID, PEER_DEVICE_ID]);

    expect(presence.sent).toHaveLength(1);
    expect(harness.FakeWebRtcTransport.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_CONNECTION_TIMEOUT_MS,
    );
    await flushConnectionCleanup();

    expect(presence.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_RETRY_DELAYS_MS[0],
    );

    expect(presence.sent).toHaveLength(2);
    expect(harness.FakeWebRtcTransport.instances).toHaveLength(2);

    manager.stop();
  });

  it("retries a connection that stays disconnected past the grace period", async () => {
    const presence = createPresence();
    const manager = createManager(presence);

    manager.updateOnlineDevices([LOCAL_DEVICE_ID, PEER_DEVICE_ID]);
    harness.FakeWebRtcTransport.instances[0]?.emit("connected");
    harness.FakeWebRtcTransport.instances[0]?.emit("disconnected");

    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_DISCONNECTED_GRACE_MS,
    );
    await flushConnectionCleanup();

    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_RETRY_DELAYS_MS[0],
    );

    expect(presence.sent).toHaveLength(2);
    expect(harness.FakeWebRtcTransport.instances).toHaveLength(2);

    manager.stop();
  });

  it("keeps a connection that recovers during the disconnected grace period", async () => {
    const presence = createPresence();
    const manager = createManager(presence);

    manager.updateOnlineDevices([LOCAL_DEVICE_ID, PEER_DEVICE_ID]);
    const transport = harness.FakeWebRtcTransport.instances[0];
    transport?.emit("connected");
    transport?.emit("disconnected");

    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_DISCONNECTED_GRACE_MS - 1,
    );
    transport?.emit("connected");

    await vi.advanceTimersByTimeAsync(60_000);

    expect(presence.sent).toHaveLength(1);
    expect(harness.FakeWebRtcTransport.instances).toHaveLength(1);

    manager.stop();
  });

  it("retries when the data channel closes while the peer connection stays connected", async () => {
    const presence = createPresence();
    const manager = createManager(presence);

    manager.updateOnlineDevices([LOCAL_DEVICE_ID, PEER_DEVICE_ID]);
    const transport = harness.FakeWebRtcTransport.instances[0];
    transport?.emit("connected");
    transport?.emitDataChannel("open");

    transport?.emitDataChannel("closed");
    await flushConnectionCleanup();

    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_RETRY_DELAYS_MS[0],
    );

    expect(presence.sent).toHaveLength(2);
    expect(harness.FakeWebRtcTransport.instances).toHaveLength(2);

    manager.stop();
  });

  it("cancels a scheduled retry when the peer goes offline", async () => {
    const presence = createPresence();
    const manager = createManager(presence);

    manager.updateOnlineDevices([LOCAL_DEVICE_ID, PEER_DEVICE_ID]);
    harness.FakeWebRtcTransport.instances[0]?.emit("failed");
    await flushConnectionCleanup();

    manager.updateOnlineDevices([LOCAL_DEVICE_ID]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(presence.sent).toHaveLength(1);

    manager.stop();
  });

  it("resets the backoff after a successful connection", async () => {
    const presence = createPresence();
    const manager = createManager(presence);

    manager.updateOnlineDevices([LOCAL_DEVICE_ID, PEER_DEVICE_ID]);

    harness.FakeWebRtcTransport.instances[0]?.emit("failed");
    await flushConnectionCleanup();
    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_RETRY_DELAYS_MS[0],
    );

    const retried = harness.FakeWebRtcTransport.instances[1];
    retried?.emit("connected");
    retried?.emit("failed");
    await flushConnectionCleanup();

    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_RETRY_DELAYS_MS[0] - 1,
    );
    expect(presence.sent).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(presence.sent).toHaveLength(3);

    manager.stop();
  });

  it("does not create duplicate attempts while a retry is pending", async () => {
    const presence = createPresence();
    const manager = createManager(presence);

    manager.updateOnlineDevices([LOCAL_DEVICE_ID, PEER_DEVICE_ID]);
    harness.FakeWebRtcTransport.instances[0]?.emit("failed");
    await flushConnectionCleanup();

    manager.updateOnlineDevices([LOCAL_DEVICE_ID, PEER_DEVICE_ID]);
    manager.updateOnlineDevices([LOCAL_DEVICE_ID, PEER_DEVICE_ID]);

    expect(presence.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(
      AUTOMATIC_RECONNECT_RETRY_DELAYS_MS[0],
    );
    expect(presence.sent).toHaveLength(2);

    manager.stop();
  });
});
