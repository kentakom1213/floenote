import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
