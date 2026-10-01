import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveRelayRtcConfiguration,
  resolveRtcConfiguration,
  testTurnCredentialEndpoint,
} from "../src/turn-credentials.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TURN credentials", () => {
  it("uses the default WebRTC configuration when no endpoint is configured", async () => {
    await expect(resolveRtcConfiguration(null)).resolves.toBeUndefined();
  });

  it("returns Cloudflare ICE servers from a credential endpoint", async () => {
    const iceServers = [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
        username: "temporary-user",
        credential: "temporary-password",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ iceServers }, { status: 200 }),
      ),
    );

    await expect(
      resolveRtcConfiguration(
        "https://turn.example/credentials/capability-token",
      ),
    ).resolves.toEqual({ iceServers });
  });

  it("returns relay-only configuration for an explicit relay attempt", async () => {
    const iceServers = [
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
        username: "temporary-user",
        credential: "temporary-password",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ iceServers }, { status: 200 }),
      ),
    );

    await expect(
      resolveRelayRtcConfiguration(
        "https://turn.example/credentials/capability-token",
      ),
    ).resolves.toEqual({
      iceServers,
      iceTransportPolicy: "relay",
    });
  });

  it("requires a configured endpoint for relay-only attempts", async () => {
    await expect(resolveRelayRtcConfiguration(null)).rejects.toThrow(
      "TURN credentials are unavailable",
    );
  });

  it("uses coordinator credentials for invitation ICE setup without a manual endpoint", async () => {
    const iceServers = [{ urls: "turn:turn.cloudflare.com:3478", username: "short", credential: "temporary" }];
    const request = vi.fn(async () => ({ iceServers, expiresAt: Date.now() + 86_400_000 }));
    await expect(resolveRtcConfiguration(null, request)).resolves.toEqual({ iceServers });
    expect(request).toHaveBeenCalledOnce();
  });

  it("uses coordinator credentials for a relay-only reconnect attempt", async () => {
    const iceServers = [{ urls: "turn:turn.cloudflare.com:3478", username: "short", credential: "temporary" }];
    const request = vi.fn(async () => ({ iceServers, expiresAt: Date.now() + 86_400_000 }));
    await expect(resolveRelayRtcConfiguration(null, request)).resolves.toEqual({
      iceServers,
      iceTransportPolicy: "relay",
    });
  });

  it("keeps invitation direct connectivity available when TURN issuance fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(resolveRtcConfiguration(null, async () => {
      throw new Error("TURN relay is unavailable");
    })).resolves.toBeUndefined();
  });

  it("rejects credential responses without a TURN server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        }),
      ),
    );

    await expect(
      testTurnCredentialEndpoint(
        "https://turn.example/credentials/capability-token",
      ),
    ).rejects.toThrow("did not return a TURN server");
  });

  it("falls back to the default configuration when the endpoint is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );

    await expect(
      resolveRtcConfiguration(
        "https://turn.example/credentials/capability-token",
      ),
    ).resolves.toBeUndefined();
  });
});
