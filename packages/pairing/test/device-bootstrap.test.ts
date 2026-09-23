import {
  destroyDeviceKeyMaterial,
  generateDeviceKeyMaterial,
  type DeviceKeyMaterial,
} from "@floe-note/crypto";
import type { Transport } from "@floe-note/transport";
import { afterEach, describe, expect, it } from "vitest";

import { exchangeJoiningDeviceIdentity } from "../src/device-bootstrap.js";

const keyMaterials: DeviceKeyMaterial[] = [];

afterEach(async () => {
  await Promise.all(keyMaterials.splice(0).map(destroyDeviceKeyMaterial));
});

class MemoryTransport implements Transport {
  #peer: MemoryTransport | null = null;
  #handlers = new Set<(data: Uint8Array) => void>();
  #closed = false;

  connect(peer: MemoryTransport): void {
    this.#peer = peer;
  }

  send(data: Uint8Array): void {
    if (this.#closed) throw new Error("Transport is closed");
    const peer = this.#peer;
    if (!peer) throw new Error("Transport is not connected");

    const copy = data.slice();
    queueMicrotask(() => peer.#deliver(copy));
  }

  onMessage(handler: (data: Uint8Array) => void): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  close(): void {
    this.#closed = true;
    this.#handlers.clear();
  }

  #deliver(data: Uint8Array): void {
    if (this.#closed) return;
    for (const handler of this.#handlers) handler(data);
  }
}

function createTransportPair(): [MemoryTransport, MemoryTransport] {
  const left = new MemoryTransport();
  const right = new MemoryTransport();
  left.connect(right);
  right.connect(left);
  return [left, right];
}

describe("device bootstrap", () => {
  it("exchanges the joining identity and normalized display name", async () => {
    const joiningKeys = await generateDeviceKeyMaterial();
    keyMaterials.push(joiningKeys);

    const [hostTransport, joinTransport] = createTransportPair();

    const [hostResult, joinResult] = await Promise.all([
      exchangeJoiningDeviceIdentity({
        role: "host",
        transport: hostTransport,
        timeoutMs: 1_000,
      }),
      exchangeJoiningDeviceIdentity({
        role: "join",
        transport: joinTransport,
        identity: joiningKeys.publicIdentity,
        displayName: "  Kenta's Pixel  ",
        timeoutMs: 1_000,
      }),
    ]);

    expect(hostResult.deviceId).toBe(joiningKeys.publicIdentity.deviceId);
    expect(hostResult.encryptionPublicKey).toEqual(
      joiningKeys.publicIdentity.encryptionPublicKey,
    );
    expect(hostResult.signingPublicKey).toEqual(
      joiningKeys.publicIdentity.signingPublicKey,
    );
    expect(hostResult.displayName).toBe("Kenta's Pixel");

    expect(joinResult.deviceId).toBe(joiningKeys.publicIdentity.deviceId);
    expect(joinResult.displayName).toBe("Kenta's Pixel");
  });

  it("rejects an empty joining device name", async () => {
    const joiningKeys = await generateDeviceKeyMaterial();
    keyMaterials.push(joiningKeys);

    const [hostTransport, joinTransport] = createTransportPair();
    const hostAbort = new AbortController();

    const hostPromise = exchangeJoiningDeviceIdentity({
      role: "host",
      transport: hostTransport,
      signal: hostAbort.signal,
      timeoutMs: 1_000,
    });

    await expect(
      exchangeJoiningDeviceIdentity({
        role: "join",
        transport: joinTransport,
        identity: joiningKeys.publicIdentity,
        displayName: "   ",
        timeoutMs: 10,
      }),
    ).rejects.toThrow("Device name must not be empty");

    hostAbort.abort();
    await expect(hostPromise).rejects.toThrow("Device bootstrap aborted");
  });
});
