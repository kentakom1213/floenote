import { afterEach, describe, expect, it, vi } from "vitest";

import { createClaimId, InvitationClient, parseInviteId } from "../src/invitation.js";
import { TurnCredentialCache } from "../src/turn-credentials.js";

const iceServers = [{ urls: "turn:turn.example:3478", username: "short", credential: "temporary" }];

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("memory-only TURN credentials", () => {
  it("reuses a valid credential and refetches after its expiry margin", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => ({ iceServers, expiresAt: Date.now() + 86_400_000 }));
    const cache = new TurnCredentialCache();
    expect(await cache.get(request)).toEqual(await cache.get(request));
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(86_400_000 - 60_000);
    await cache.get(request);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps credentials in memory and sends only InviteId and ClaimId", async () => {
    const localStorage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", localStorage);
    const fetchMock = vi.fn(async () => Response.json({ iceServers, expiresAt: Date.now() + 86_400_000 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new InvitationClient("https://coordinator.example");
    const inviteId = parseInviteId("a".repeat(32));
    const claimId = createClaimId();
    await client.requestTurnCredentials(inviteId, claimId);
    await client.requestTurnCredentials(inviteId, claimId);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0].toString()).toBe(`https://coordinator.example/invites/${inviteId}/turn-credentials`);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({ claimId });
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});
