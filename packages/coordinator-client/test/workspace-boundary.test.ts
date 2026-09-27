import { parseDeviceId, parseWorkspaceId } from "@floe-note/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createClaimId,
  InvitationClient,
  parseInviteId,
} from "../src/invitation.js";
import { SecurityCoordinatorClient } from "../src/security-client.js";

const workspaceA = parseWorkspaceId("00000000-0000-7000-8000-000000000010");
const workspaceB = parseWorkspaceId("00000000-0000-7000-8000-000000000011");
const deviceId = parseDeviceId("00000000-0000-7000-8000-000000000001");

afterEach(() => vi.unstubAllGlobals());

describe("Workspace coordinator client boundary", () => {
  it("uses the Workspace returned by invitation claim for bootstrap", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        workspaceId: workspaceA,
        sessionId: "a".repeat(32),
        expiresAt: Date.now() + 60_000,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const claimed = await new InvitationClient(
      "https://coordinator.example",
    ).claimInvite(parseInviteId("b".repeat(32)), createClaimId());

    expect(claimed.workspaceId).toBe(workspaceA);
    expect(new URL(fetch.mock.calls[0]![0] as URL).pathname).toBe(
      `/invites/${"b".repeat(32)}/claim`,
    );
  });

  it("rejects a WorkspaceKey envelope returned for another Workspace", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        protocolVersion: 1,
        workspaceId: workspaceB,
        keyEpoch: 1,
        securityHead: "00".repeat(32),
        recipientDeviceId: deviceId,
        sealedEnvelope: "01",
        signerDeviceId: deviceId,
        signature: "02".repeat(64),
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      new SecurityCoordinatorClient(
        "https://coordinator.example",
      ).getWorkspaceKeyEnvelope(workspaceA, 1, deviceId),
    ).rejects.toThrow("WorkspaceKey envelope WorkspaceId does not match request");
    expect(new URL(fetch.mock.calls[0]![0] as URL).pathname).toBe(
      `/workspaces/${workspaceA}/workspace-keys/1/${deviceId}`,
    );
  });
});
