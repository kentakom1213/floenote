import { readFileSync } from "node:fs";

import { createDeviceId, createWorkspaceId } from "@floe-note/domain";
import {
  attachAddDeviceSignature,
  attachCreateWorkspaceSignature,
  attachRevokeDeviceSignature,
  createUnsignedAddDeviceTransition,
  createUnsignedCreateWorkspaceTransition,
  createUnsignedRevokeDeviceTransition,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  deriveRevokeDeviceSecurityState,
  type DevicePublicIdentity,
} from "@floe-note/security";
import { describe, expect, it, vi } from "vitest";

import { allocateInvitationForAuthorizedPresence } from "../src/invitation-authorization.js";

function device(seed: number): DevicePublicIdentity {
  return {
    deviceId: createDeviceId(),
    encryptionPublicKey: new Uint8Array(32).fill(seed),
    signingPublicKey: new Uint8Array(32).fill(seed + 1),
  };
}

function signature(seed: number): Uint8Array {
  return new Uint8Array(64).fill(seed);
}

function head(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("invitation creation authorization", () => {
  it("allocates an invitation for a currently authorized device at the current head", async () => {
    const workspaceId = createWorkspaceId();
    const deviceA = device(1);
    const state = deriveInitialSecurityState(
      attachCreateWorkspaceSignature(
        createUnsignedCreateWorkspaceTransition(workspaceId, deviceA),
        signature(1),
      ),
      head(1),
    );
    const allocate = vi.fn(async () => new Response(null, { status: 201 }));

    const result = await allocateInvitationForAuthorizedPresence(
      state,
      {
        workspaceId,
        deviceId: deviceA.deviceId,
        securityHead: bytesToHex(state.headHash),
      },
      allocate,
    );

    expect(result.kind).toBe("allocated");
    expect(allocate).toHaveBeenCalledOnce();
    expect(allocate).toHaveBeenCalledWith(workspaceId);
  });

  it("does not allocate from a presence socket with a stale security head", async () => {
    const workspaceId = createWorkspaceId();
    const deviceA = device(10);
    const deviceB = device(20);
    const initial = deriveInitialSecurityState(
      attachCreateWorkspaceSignature(
        createUnsignedCreateWorkspaceTransition(workspaceId, deviceA),
        signature(2),
      ),
      head(2),
    );
    const afterAdd = deriveAddDeviceSecurityState(
      initial,
      attachAddDeviceSignature(
        createUnsignedAddDeviceTransition(
          initial,
          deviceB,
          deviceA.deviceId,
        ),
        signature(3),
      ),
      head(3),
    );
    const allocate = vi.fn(async () => new Response(null, { status: 201 }));

    const result = await allocateInvitationForAuthorizedPresence(
      afterAdd,
      {
        workspaceId,
        deviceId: deviceA.deviceId,
        securityHead: bytesToHex(initial.headHash),
      },
      allocate,
    );

    expect(result).toEqual({ kind: "stale-security-head" });
    expect(allocate).not.toHaveBeenCalled();
  });

  it("does not use presence for one Workspace to allocate in another", async () => {
    const workspaceA = createWorkspaceId();
    const workspaceB = createWorkspaceId();
    const deviceA = device(7);
    const state = deriveInitialSecurityState(
      attachCreateWorkspaceSignature(
        createUnsignedCreateWorkspaceTransition(workspaceA, deviceA),
        signature(7),
      ),
      head(7),
    );
    const allocate = vi.fn(async () => new Response(null, { status: 201 }));

    const result = await allocateInvitationForAuthorizedPresence(
      state,
      {
        workspaceId: workspaceB,
        deviceId: deviceA.deviceId,
        securityHead: bytesToHex(state.headHash),
      },
      allocate,
    );

    expect(result).toEqual({ kind: "unauthorized-device" });
    expect(allocate).not.toHaveBeenCalled();
  });

  it("does not allocate an invitation for a revoked device", async () => {
    const workspaceId = createWorkspaceId();
    const deviceA = device(30);
    const deviceB = device(40);
    const initial = deriveInitialSecurityState(
      attachCreateWorkspaceSignature(
        createUnsignedCreateWorkspaceTransition(workspaceId, deviceA),
        signature(4),
      ),
      head(4),
    );
    const afterAdd = deriveAddDeviceSecurityState(
      initial,
      attachAddDeviceSignature(
        createUnsignedAddDeviceTransition(
          initial,
          deviceB,
          deviceA.deviceId,
        ),
        signature(5),
      ),
      head(5),
    );
    const afterRevoke = deriveRevokeDeviceSecurityState(
      afterAdd,
      attachRevokeDeviceSignature(
        createUnsignedRevokeDeviceTransition(
          afterAdd,
          deviceB.deviceId,
          deviceA.deviceId,
        ),
        signature(6),
      ),
      head(6),
    );
    const allocate = vi.fn(async () => new Response(null, { status: 201 }));

    const result = await allocateInvitationForAuthorizedPresence(
      afterRevoke,
      {
        workspaceId,
        deviceId: deviceB.deviceId,
        securityHead: bytesToHex(afterRevoke.headHash),
      },
      allocate,
    );

    expect(result).toEqual({ kind: "unauthorized-device" });
    expect(allocate).not.toHaveBeenCalled();
  });

  it("does not expose the legacy unauthenticated HTTP invitation creation route", () => {
    const coordinatorSource = readFileSync(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );
    const publicWorker = coordinatorSource.slice(
      coordinatorSource.indexOf("export default"),
      coordinatorSource.indexOf("export class WorkspaceCoordinator"),
    );

    expect(coordinatorSource).not.toContain("parseCreateInviteRoute");
    expect(coordinatorSource).not.toContain("createInviteWorkspaceId");
    expect(publicWorker).not.toContain("createInvitation(");
  });
});
