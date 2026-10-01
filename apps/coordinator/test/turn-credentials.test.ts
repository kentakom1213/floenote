import { createDeviceId, createWorkspaceId } from "@floe-note/domain";
import {
  attachCreateWorkspaceSignature,
  createUnsignedCreateWorkspaceTransition,
  deriveInitialSecurityState,
  securityStateToWire,
  type SecurityState,
} from "@floe-note/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown, readonly env: unknown) {}
  },
}));

import { InvitationCoordinator, WorkspaceCoordinator } from "../src/index.js";
import { generateTurnCredentials } from "../src/turn-credentials.js";

const INVITE_ID = "a".repeat(32);
const CLAIM_ID = "b".repeat(32);
const ICE_SERVERS = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
  { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "short-user", credential: "short-password" },
];

function storage() {
  const values = new Map<string, unknown>();
  return {
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => { values.set(key, value); },
    transaction: async (callback: (store: unknown) => Promise<void>) => callback({
      get: async (key: string) => values.get(key),
      put: async (key: string, value: unknown) => { values.set(key, value); },
    }),
  };
}

function rateLimit(limit: number) {
  const counts = new Map<string, number>();
  return {
    limit: vi.fn(async ({ key }: { key: string }) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { success: next <= limit };
    }),
  };
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    TURN_ENABLED: "true",
    TURN_KEY_ID: "key-id",
    TURN_KEY_API_TOKEN: "server-secret",
    TURN_DEVICE_RATE_LIMIT: rateLimit(5),
    TURN_INVITE_RATE_LIMIT: rateLimit(3),
    ...overrides,
  };
}

function upstream() {
  return vi.fn(async () => Response.json({ iceServers: ICE_SERVERS }, { status: 201 }));
}

beforeEach(() => vi.stubGlobal("fetch", upstream()));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Cloudflare TURN generation", () => {
  it("uses the 24-hour ICE API and returns only short-lived client fields", async () => {
    const result = await generateTurnCredentials(env(), "device:opaque-id");
    expect(result).toEqual({ iceServers: ICE_SERVERS, expiresAt: expect.any(Number) });
    expect(result.expiresAt).toBeGreaterThan(Date.now() + 86_000_000);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers");
    expect(init?.body).toBe(JSON.stringify({ ttl: 86_400, customIdentifier: "device:opaque-id" }));
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer server-secret" }));
  });

  it.each([
    [{ TURN_ENABLED: "false" }, "TURN relay is unavailable"],
    [{ TURN_KEY_ID: undefined }, "not configured"],
    [{ TURN_KEY_API_TOKEN: undefined }, "not configured"],
  ])("fails cleanly for disabled or missing configuration", async (configuration, message) => {
    await expect(generateTurnCredentials(env(configuration), "device:test")).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects Cloudflare failures and malformed ICE data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("failure", { status: 500 })));
    await expect(generateTurnCredentials(env(), "device:test")).rejects.toThrow("Could not generate");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ iceServers: [{ urls: "turn:bad" }] })));
    await expect(generateTurnCredentials(env(), "device:test")).rejects.toThrow("invalid response");
  });
});

describe("authorized Presence TURN issuance", () => {
  const workspaceId = createWorkspaceId();
  const deviceId = createDeviceId();
  const state = deriveInitialSecurityState(
    attachCreateWorkspaceSignature(
      createUnsignedCreateWorkspaceTransition(workspaceId, {
        deviceId,
        encryptionPublicKey: new Uint8Array(32).fill(1),
        signingPublicKey: new Uint8Array(32).fill(2),
      }),
      new Uint8Array(64).fill(3),
    ),
    new Uint8Array(32).fill(4),
  );
  async function setup(
    overrides: Record<string, unknown> = {},
    currentState: SecurityState = state,
    actor = deviceId,
  ) {
    const store = storage();
    await store.put("security-state", securityStateToWire(currentState));
    const coordinator = new WorkspaceCoordinator({ storage: store } as never, env(overrides) as never);
    const sent: unknown[] = [];
    const close = vi.fn();
    const securityHead = Array.from(currentState.headHash, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const attachment = { kind: "presence", workspaceId: currentState.workspaceId, deviceId: actor, securityHead, challenge: "0".repeat(64) };
    const socket = {
      deserializeAttachment: () => attachment,
      send: (value: string) => sent.push(JSON.parse(value)),
      close,
    } as unknown as WebSocket;
    const request = async (requestId: number) => coordinator.webSocketMessage(
      socket, JSON.stringify({ type: "request-turn-credentials", requestId }),
    );
    return { sent, close, attachment, request, coordinator, socket, store };
  }

  it("responds to an authenticated current device with the matching requestId", async () => {
    const context = await setup();
    await context.request(12);
    expect(context.sent).toEqual([{ type: "turn-credentials", requestId: 12, iceServers: ICE_SERVERS, expiresAt: expect.any(Number) }]);
    expect(context.close).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated, revoked, and stale-head sockets", async () => {
    const context = await setup();
    delete (context.attachment as { deviceId?: string }).deviceId;
    await context.request(1);
    expect(context.close).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    const revoked = await setup();
    revoked.attachment.deviceId = createDeviceId();
    await revoked.request(2);
    expect(revoked.sent).toEqual([expect.objectContaining({ type: "control-error", requestId: 2 })]);
    expect(fetch).not.toHaveBeenCalled();

    const stale = await setup();
    stale.attachment.securityHead = "0".repeat(64);
    await stale.request(3);
    expect(stale.sent).toEqual([expect.objectContaining({ type: "control-error", requestId: 3 })]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects disabled, misconfigured, upstream-failed, and rate-limited issuance", async () => {
    const disabled = await setup({ TURN_ENABLED: "false" });
    await disabled.request(1);
    expect(disabled.sent).toEqual([{ type: "control-error", requestId: 1, message: "TURN relay is unavailable" }]);
    const missing = await setup({ TURN_KEY_ID: undefined });
    await missing.request(2);
    expect(missing.sent).toEqual([expect.objectContaining({ message: expect.stringContaining("not configured") })]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const failed = await setup();
    await failed.request(3);
    expect(failed.sent).toEqual([expect.objectContaining({ message: "Could not generate TURN credentials" })]);
    vi.stubGlobal("fetch", upstream());
    const limiter = rateLimit(1);
    const limited = await setup({ TURN_DEVICE_RATE_LIMIT: limiter });
    await limited.request(4);
    await limited.request(5);
    expect(limited.sent[1]).toEqual({ type: "control-error", requestId: 5, message: "TURN credential request rate limited" });
    expect(limiter.limit).toHaveBeenCalledWith({ key: deviceId });
  });

  it("limits DeviceIds independently", async () => {
    const limiter = rateLimit(1);
    const first = await setup({ TURN_DEVICE_RATE_LIMIT: limiter });
    const otherDeviceId = createDeviceId();
    const otherState = deriveInitialSecurityState(
      attachCreateWorkspaceSignature(
        createUnsignedCreateWorkspaceTransition(workspaceId, {
          deviceId: otherDeviceId,
          encryptionPublicKey: new Uint8Array(32).fill(5),
          signingPublicKey: new Uint8Array(32).fill(6),
        }),
        new Uint8Array(64).fill(7),
      ),
      new Uint8Array(32).fill(8),
    );
    const other = await setup({ TURN_DEVICE_RATE_LIMIT: limiter }, otherState, otherDeviceId);
    await first.request(1);
    await first.request(2);
    await other.request(3);
    expect(first.sent[1]).toEqual(expect.objectContaining({ type: "control-error" }));
    expect(other.sent[0]).toEqual(expect.objectContaining({ type: "turn-credentials" }));
    expect(limiter.limit).toHaveBeenCalledWith({ key: otherDeviceId });
  });

  it("does not deliver credentials if SecurityState changes during upstream issuance", async () => {
    const context = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => {
      await context.store.put("security-state", securityStateToWire({
        ...state,
        headHash: new Uint8Array(32).fill(9),
      }));
      return Response.json({ iceServers: ICE_SERVERS }, { status: 201 });
    }));
    await context.request(7);
    expect(context.sent).toEqual([expect.objectContaining({ type: "control-error", requestId: 7 })]);
  });
});

describe("claimed invitation TURN issuance", () => {
  async function setup(state: string = "claimed", overrides: Record<string, unknown> = {}) {
    const store = storage();
    await store.put("invite", {
      protocolVersion: 1,
      workspaceId: createWorkspaceId(),
      sessionId: "c".repeat(32),
      state,
      claimId: CLAIM_ID,
      expiresAt: Date.now() + 60_000,
      ...overrides,
    });
    const coordinator = new InvitationCoordinator({ storage: store } as never, env(overrides) as never);
    const request = (claimId = CLAIM_ID, inviteId = INVITE_ID) => coordinator.fetch(
      new Request(`https://invitation.internal/turn-credentials/${inviteId}`, {
        method: "POST", body: JSON.stringify({ claimId }),
      }),
    );
    return { request, store };
  }

  it("issues credentials only for the exact claimed capability without PairingSecret", async () => {
    const { request } = await setup();
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ iceServers: ICE_SERVERS, expiresAt: expect.any(Number) });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.body).toContain(`invite:${INVITE_ID}`);
  });

  it.each(["waiting", "cancelled", "consumed", "expired"])("rejects %s invitations", async (state) => {
    const { request } = await setup(state);
    expect((await request()).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects expired, mismatched-claim, and disabled invitations", async () => {
    expect((await (await setup("claimed", { expiresAt: Date.now() - 1 })).request()).status).toBe(410);
    expect((await (await setup()).request("d".repeat(32))).status).toBe(409);
    expect((await (await setup()).request(CLAIM_ID.toUpperCase())).status).toBe(409);
    expect((await (await setup("claimed", { TURN_ENABLED: "false" })).request()).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("limits each InviteId separately", async () => {
    const limiter = rateLimit(1);
    const first = await setup("claimed", { TURN_INVITE_RATE_LIMIT: limiter });
    const second = await setup("claimed", { TURN_INVITE_RATE_LIMIT: limiter });
    expect((await first.request()).status).toBe(200);
    expect((await first.request()).status).toBe(429);
    expect((await second.request(CLAIM_ID, "e".repeat(32))).status).toBe(200);
  });

  it("does not deliver credentials after cancellation during upstream issuance", async () => {
    const context = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => {
      const record = await context.store.get("invite") as Record<string, unknown>;
      await context.store.put("invite", { ...record, state: "cancelled" });
      return Response.json({ iceServers: ICE_SERVERS }, { status: 201 });
    }));
    expect((await context.request()).status).toBe(409);
  });
});
