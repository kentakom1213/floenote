import { readFileSync } from "node:fs";

import { createDeviceId, createProjectId } from "@floe-note/domain";
import {
  attachAddDeviceSignature,
  attachCreateProjectSignature,
  attachRevokeDeviceSignature,
  createUnsignedAddDeviceTransition,
  createUnsignedCreateProjectTransition,
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
    const projectId = createProjectId();
    const deviceA = device(1);
    const state = deriveInitialSecurityState(
      attachCreateProjectSignature(
        createUnsignedCreateProjectTransition(projectId, deviceA),
        signature(1),
      ),
      head(1),
    );
    const allocate = vi.fn(async () => new Response(null, { status: 201 }));

    const result = await allocateInvitationForAuthorizedPresence(
      state,
      {
        projectId,
        deviceId: deviceA.deviceId,
        securityHead: bytesToHex(state.headHash),
      },
      allocate,
    );

    expect(result.kind).toBe("allocated");
    expect(allocate).toHaveBeenCalledOnce();
    expect(allocate).toHaveBeenCalledWith(projectId);
  });

  it("does not allocate from a presence socket with a stale security head", async () => {
    const projectId = createProjectId();
    const deviceA = device(10);
    const deviceB = device(20);
    const initial = deriveInitialSecurityState(
      attachCreateProjectSignature(
        createUnsignedCreateProjectTransition(projectId, deviceA),
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
        projectId,
        deviceId: deviceA.deviceId,
        securityHead: bytesToHex(initial.headHash),
      },
      allocate,
    );

    expect(result).toEqual({ kind: "stale-security-head" });
    expect(allocate).not.toHaveBeenCalled();
  });

  it("does not allocate an invitation for a revoked device", async () => {
    const projectId = createProjectId();
    const deviceA = device(30);
    const deviceB = device(40);
    const initial = deriveInitialSecurityState(
      attachCreateProjectSignature(
        createUnsignedCreateProjectTransition(projectId, deviceA),
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
        projectId,
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
      coordinatorSource.indexOf("export class ProjectCoordinator"),
    );

    expect(coordinatorSource).not.toContain("parseCreateInviteRoute");
    expect(coordinatorSource).not.toContain("createInviteProjectId");
    expect(publicWorker).not.toContain("createInvitation(");
  });
});
