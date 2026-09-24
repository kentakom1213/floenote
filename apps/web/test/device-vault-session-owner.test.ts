import type { DeviceVaultSession } from "@floe-note/vault";
import { describe, expect, it, vi } from "vitest";

import {
  closeOwnedDeviceVaultSession,
  handoffDeviceVaultSession,
  type DeviceVaultSessionOwner,
} from "../src/device-vault-session-owner.js";

function fakeSession(
  close: () => Promise<void> = async () => undefined,
): DeviceVaultSession {
  return { close } as DeviceVaultSession;
}

describe("Device Vault session ownership", () => {
  it("hands off the exact session and clears the source owner", () => {
    const session = fakeSession();
    const owner: DeviceVaultSessionOwner = { current: session };
    let received: DeviceVaultSession | null = null;

    handoffDeviceVaultSession(owner, (next) => {
      received = next;
    });

    expect(received).toBe(session);
    expect(owner.current).toBeNull();
  });

  it("restores ownership when the receiver rejects the handoff", () => {
    const session = fakeSession();
    const owner: DeviceVaultSessionOwner = { current: session };

    expect(() =>
      handoffDeviceVaultSession(owner, () => {
        throw new Error("receiver failed");
      }),
    ).toThrow("receiver failed");

    expect(owner.current).toBe(session);
  });

  it("closes an untransferred session once and clears ownership before close", async () => {
    const owner: DeviceVaultSessionOwner = { current: null };
    const close = vi.fn(async () => {
      expect(owner.current).toBeNull();
    });
    owner.current = fakeSession(close);

    await closeOwnedDeviceVaultSession(owner);
    await closeOwnedDeviceVaultSession(owner);

    expect(close).toHaveBeenCalledTimes(1);
    expect(owner.current).toBeNull();
  });
});
