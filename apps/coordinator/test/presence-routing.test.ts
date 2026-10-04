import { describe, expect, it } from "vitest";

import {
  AUTHORIZED_PRESENCE_LEASE_MS,
  findPresenceSocketsForDevice,
  isPresenceLeaseActive,
} from "../src/presence-routing.js";

type FakeSocket = {
  name: string;
  deserializeAttachment: () => unknown;
};

function socket(name: string, attachment: unknown): FakeSocket {
  return {
    name,
    deserializeAttachment: () => attachment,
  };
}

describe("presence reconnect routing", () => {
  it("returns every presence socket for the target device", () => {
    const target = "00000000-0000-7000-8000-000000000001";
    const sockets = [
      socket("stale", { kind: "presence", deviceId: target }),
      socket("active", { kind: "presence", deviceId: target }),
      socket("other", {
        kind: "presence",
        deviceId: "00000000-0000-7000-8000-000000000002",
      }),
      socket("signaling", { kind: "signaling", sessionId: "abc" }),
    ];

    expect(
      findPresenceSocketsForDevice(sockets, target).map(
        (candidate) => candidate.name,
      ),
    ).toEqual(["stale", "active"]);

    // Closing one same-device Presence socket leaves the other routable.
    expect(
      findPresenceSocketsForDevice(sockets.slice(1), target).map(
        (candidate) => candidate.name,
      ),
    ).toEqual(["active"]);
  });

  it("excludes expired lease-aware sockets while keeping live duplicates routable", () => {
    const target = "00000000-0000-7000-8000-000000000001";
    const now = 1_000_000;
    const sockets = [
      socket("expired", {
        kind: "presence",
        deviceId: target,
        lastSeenAt: now - AUTHORIZED_PRESENCE_LEASE_MS,
      }),
      socket("live", {
        kind: "presence",
        deviceId: target,
        lastSeenAt: now - AUTHORIZED_PRESENCE_LEASE_MS + 1,
      }),
    ];

    expect(
      findPresenceSocketsForDevice(sockets, target, now).map(
        (candidate) => candidate.name,
      ),
    ).toEqual(["live"]);
  });
});

describe("presence lease", () => {
  it("expires a lease at the configured deadline", () => {
    const now = 1_000_000;

    expect(
      isPresenceLeaseActive(
        now - AUTHORIZED_PRESENCE_LEASE_MS + 1,
        now,
      ),
    ).toBe(true);
    expect(
      isPresenceLeaseActive(now - AUTHORIZED_PRESENCE_LEASE_MS, now),
    ).toBe(false);
  });

  it("does not treat attachments without a lease timestamp as live", () => {
    expect(isPresenceLeaseActive(undefined, 1_000_000)).toBe(false);
  });
});
