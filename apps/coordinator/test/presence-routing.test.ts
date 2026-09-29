import { describe, expect, it } from "vitest";

import { findPresenceSocketsForDevice } from "../src/presence-routing.js";

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
  });
});
