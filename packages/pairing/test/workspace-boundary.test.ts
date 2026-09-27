import {
  createDeviceId,
  createWorkspaceId,
  type WorkspaceId,
} from "@floe-note/domain";
import {
  createPairingSecret,
  parseInviteId,
  parseSessionId,
} from "@floe-note/coordinator-client";
import {
  attachCreateWorkspaceSignature,
  createUnsignedCreateWorkspaceTransition,
  deriveInitialSecurityState,
  type DevicePublicIdentity,
} from "@floe-note/security";
import type { Transport } from "@floe-note/transport";
import { describe, expect, it, vi } from "vitest";

import { authenticatePairingChannel } from "../src/pairing-authentication.js";
import {
  receiveWorkspaceKeyDelivery,
  sendWorkspaceKeyDelivery,
} from "../src/workspace-key-delivery.js";

class MemoryTransport implements Transport {
  #peer: MemoryTransport | null = null;
  #handlers = new Set<(data: Uint8Array) => void>();

  connect(peer: MemoryTransport): void {
    this.#peer = peer;
  }

  send(data: Uint8Array): void {
    const peer = this.#peer;
    if (!peer) throw new Error("Transport is not connected");
    queueMicrotask(() => peer.#receive(data.slice()));
  }

  onMessage(handler: (data: Uint8Array) => void): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  close(): void {
    this.#handlers.clear();
  }

  #receive(data: Uint8Array): void {
    for (const handler of this.#handlers) handler(data);
  }
}

function transportPair(): [MemoryTransport, MemoryTransport] {
  const host = new MemoryTransport();
  const join = new MemoryTransport();
  host.connect(join);
  join.connect(host);
  return [host, join];
}

const inviteId = parseInviteId("a".repeat(32));
const sessionId = parseSessionId("b".repeat(32));

function createState(
  workspaceId: WorkspaceId,
  recipient: DevicePublicIdentity,
) {
  return deriveInitialSecurityState(
    attachCreateWorkspaceSignature(
      createUnsignedCreateWorkspaceTransition(workspaceId, recipient),
      new Uint8Array(64).fill(3),
    ),
    new Uint8Array(32).fill(4),
  );
}

describe("Workspace pairing boundary", () => {
  it("rejects a pairing proof made for a different Workspace", async () => {
    const [host, join] = transportPair();
    const pairingSecret = createPairingSecret();
    const hostPromise = authenticatePairingChannel({
      role: "host",
      inviteId,
      workspaceId: createWorkspaceId(),
      sessionId,
      pairingSecret,
      transport: host,
      timeoutMs: 1_000,
    });
    const joinPromise = authenticatePairingChannel({
      role: "join",
      inviteId,
      workspaceId: createWorkspaceId(),
      sessionId,
      pairingSecret,
      transport: join,
      timeoutMs: 1_000,
    });

    const results = await Promise.allSettled([hostPromise, joinPromise]);
    expect(results).toEqual([
      expect.objectContaining({ status: "rejected" }),
      expect.objectContaining({ status: "rejected" }),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(Error);
        expect((result.reason as Error).message).toBe(
          "PairingSecret authentication failed",
        );
      }
    }
  });

  it("rejects WorkspaceKey delivery to a different Workspace before storage", async () => {
    const workspaceA = createWorkspaceId();
    const workspaceB = createWorkspaceId();
    const recipientIdentity = {
      deviceId: createDeviceId(),
      encryptionPublicKey: new Uint8Array(32).fill(1),
      signingPublicKey: new Uint8Array(32).fill(2),
    };
    const state = createState(workspaceA, recipientIdentity);
    const [host, join] = transportPair();
    const abort = new AbortController();
    const onDelivery = vi.fn(async () => {});
    const receive = receiveWorkspaceKeyDelivery({
      transport: join,
      workspaceId: workspaceB,
      recipientIdentity,
      onDelivery,
      timeoutMs: 1_000,
    });
    const send = sendWorkspaceKeyDelivery({
      transport: host,
      securityState: state,
      recipientDeviceId: recipientIdentity.deviceId,
      sealedEnvelope: new Uint8Array([1]),
      signal: abort.signal,
      timeoutMs: 1_000,
    });

    await expect(receive).rejects.toThrow(
      "WorkspaceKey delivery does not target this device",
    );
    expect(onDelivery).not.toHaveBeenCalled();
    abort.abort();
    await expect(send).rejects.toThrow("WorkspaceKey delivery aborted");
  });

  it("ignores an acknowledgement for another Workspace", async () => {
    const workspaceA = createWorkspaceId();
    const workspaceB = createWorkspaceId();
    const recipientIdentity = {
      deviceId: createDeviceId(),
      encryptionPublicKey: new Uint8Array(32).fill(1),
      signingPublicKey: new Uint8Array(32).fill(2),
    };
    const state = createState(workspaceA, recipientIdentity);
    const [host, join] = transportPair();
    const abort = new AbortController();
    const replyReceived = new Promise<void>((resolve) => {
      host.onMessage(() => resolve());
    });
    join.onMessage((data) => {
      const text = new TextDecoder().decode(data);
      const prefix = "floe-note:workspace-key-delivery:v1:";
      const delivery = JSON.parse(
        text.slice(prefix.length),
      ) as Record<string, unknown>;
      join.send(
        new TextEncoder().encode(prefix + JSON.stringify({
          protocolVersion: 1,
          type: "workspace-key-stored",
          workspaceId: workspaceB,
          keyEpoch: delivery.keyEpoch,
          recipientDeviceId: delivery.recipientDeviceId,
          securityHead: delivery.securityHead,
        })),
      );
    });

    let acknowledged = false;
    const send = sendWorkspaceKeyDelivery({
      transport: host,
      securityState: state,
      recipientDeviceId: recipientIdentity.deviceId,
      sealedEnvelope: new Uint8Array([1]),
      signal: abort.signal,
      timeoutMs: 1_000,
    }).then(() => {
      acknowledged = true;
    });

    await replyReceived;
    expect(acknowledged).toBe(false);
    abort.abort();
    await expect(send).rejects.toThrow("WorkspaceKey delivery aborted");
  });

  it("acknowledges delivery only after WorkspaceKey storage completes", async () => {
    const workspaceId = createWorkspaceId();
    const recipientIdentity = {
      deviceId: createDeviceId(),
      encryptionPublicKey: new Uint8Array(32).fill(1),
      signingPublicKey: new Uint8Array(32).fill(2),
    };
    const state = createState(workspaceId, recipientIdentity);
    const [host, join] = transportPair();
    let finishStorage: (() => void) | undefined;
    const storage = new Promise<void>((resolve) => {
      finishStorage = resolve;
    });
    const onDelivery = vi.fn(async () => storage);
    const receive = receiveWorkspaceKeyDelivery({
      transport: join,
      workspaceId,
      recipientIdentity,
      onDelivery,
      timeoutMs: 1_000,
    });
    let acknowledged = false;
    const send = sendWorkspaceKeyDelivery({
      transport: host,
      securityState: state,
      recipientDeviceId: recipientIdentity.deviceId,
      sealedEnvelope: new Uint8Array([1]),
      timeoutMs: 1_000,
    }).then(() => {
      acknowledged = true;
    });

    await vi.waitFor(() => expect(onDelivery).toHaveBeenCalledOnce());
    expect(acknowledged).toBe(false);
    finishStorage?.();

    await expect(receive).resolves.toEqual(state);
    await expect(send).resolves.toBeUndefined();
    expect(acknowledged).toBe(true);
  });
});
