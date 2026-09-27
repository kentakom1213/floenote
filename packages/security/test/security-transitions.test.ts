import { createDeviceId, createWorkspaceId } from "@floe-note/domain";
import { describe, expect, it } from "vitest";

import {
  attachAddDeviceSignature,
  attachCreateWorkspaceSignature,
  attachWorkspaceKeyRotationEnvelopeSignature,
  attachRevokeDeviceSignature,
  createUnsignedAddDeviceTransition,
  createUnsignedCreateWorkspaceTransition,
  createUnsignedRevokeDeviceTransition,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  deriveRevokeDeviceSecurityState,
  encodeUnsignedWorkspaceKeyRotationEnvelope,
  type DevicePublicIdentity,
} from "../src/index.js";

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

describe("SecurityState transitions", () => {
  it("advances sequence and key epoch across add and revoke", () => {
    const workspaceId = createWorkspaceId();
    const deviceA = device(1);
    const deviceB = device(10);

    const createTransition = attachCreateWorkspaceSignature(
      createUnsignedCreateWorkspaceTransition(workspaceId, deviceA),
      signature(1),
    );
    const initial = deriveInitialSecurityState(createTransition, head(1));

    expect(initial.sequence).toBe(0);
    expect(initial.keyEpoch).toBe(1);
    expect(initial.devices.map((entry) => entry.deviceId)).toEqual([
      deviceA.deviceId,
    ]);

    const addTransition = attachAddDeviceSignature(
      createUnsignedAddDeviceTransition(
        initial,
        deviceB,
        deviceA.deviceId,
      ),
      signature(2),
    );
    const afterAdd = deriveAddDeviceSecurityState(
      initial,
      addTransition,
      head(2),
    );

    expect(afterAdd.sequence).toBe(1);
    expect(afterAdd.keyEpoch).toBe(1);
    expect(afterAdd.devices.map((entry) => entry.deviceId).sort()).toEqual(
      [deviceA.deviceId, deviceB.deviceId].sort(),
    );

    const revokeTransition = attachRevokeDeviceSignature(
      createUnsignedRevokeDeviceTransition(
        afterAdd,
        deviceB.deviceId,
        deviceA.deviceId,
      ),
      signature(3),
    );
    const afterRevoke = deriveRevokeDeviceSecurityState(
      afterAdd,
      revokeTransition,
      head(3),
    );

    expect(afterRevoke.sequence).toBe(2);
    expect(afterRevoke.keyEpoch).toBe(2);
    expect(afterRevoke.devices.map((entry) => entry.deviceId)).toEqual([
      deviceA.deviceId,
    ]);
  });

  it("rejects transitions that do not extend the current head", () => {
    const workspaceId = createWorkspaceId();
    const deviceA = device(20);
    const deviceB = device(30);
    const initial = deriveInitialSecurityState(
      attachCreateWorkspaceSignature(
        createUnsignedCreateWorkspaceTransition(workspaceId, deviceA),
        signature(4),
      ),
      head(4),
    );

    const unsigned = createUnsignedAddDeviceTransition(
      initial,
      deviceB,
      deviceA.deviceId,
    );
    unsigned.previousHash[0] ^= 0xff;

    const transition = attachAddDeviceSignature(unsigned, signature(5));

    expect(() =>
      deriveAddDeviceSecurityState(initial, transition, head(5)),
    ).toThrow("AddDevice does not extend current SecurityState");
  });

  it("rejects AddDevice transitions from another Workspace", () => {
    const workspaceId = createWorkspaceId();
    const deviceA = device(31);
    const deviceB = device(32);
    const initial = deriveInitialSecurityState(
      attachCreateWorkspaceSignature(
        createUnsignedCreateWorkspaceTransition(workspaceId, deviceA),
        signature(9),
      ),
      head(9),
    );
    const transition = attachAddDeviceSignature(
      createUnsignedAddDeviceTransition(initial, deviceB, deviceA.deviceId),
      signature(10),
    );

    expect(() =>
      deriveAddDeviceSecurityState(
        { ...initial, workspaceId: createWorkspaceId() },
        transition,
        head(10),
      ),
    ).toThrow("AddDevice does not extend current SecurityState");
  });

  it("rejects AddDevice for an already authorized DeviceId", () => {
    const workspaceId = createWorkspaceId();
    const deviceA = device(35);
    const initial = deriveInitialSecurityState(
      attachCreateWorkspaceSignature(
        createUnsignedCreateWorkspaceTransition(workspaceId, deviceA),
        signature(8),
      ),
      head(8),
    );

    expect(() =>
      createUnsignedAddDeviceTransition(
        initial,
        {
          deviceId: deviceA.deviceId,
          encryptionPublicKey: deviceA.encryptionPublicKey.slice(),
          signingPublicKey: deviceA.signingPublicKey.slice(),
        },
        deviceA.deviceId,
      ),
    ).toThrow("Device is already authorized");
  });

  it("rejects RevokeDevice transitions from another Workspace", () => {
    const workspaceId = createWorkspaceId();
    const deviceA = device(36);
    const deviceB = device(37);
    const initial = deriveInitialSecurityState(
      attachCreateWorkspaceSignature(
        createUnsignedCreateWorkspaceTransition(workspaceId, deviceA),
        signature(11),
      ),
      head(11),
    );
    const afterAdd = deriveAddDeviceSecurityState(
      initial,
      attachAddDeviceSignature(
        createUnsignedAddDeviceTransition(initial, deviceB, deviceA.deviceId),
        signature(12),
      ),
      head(12),
    );
    const transition = attachRevokeDeviceSignature(
      createUnsignedRevokeDeviceTransition(
        afterAdd,
        deviceB.deviceId,
        deviceA.deviceId,
      ),
      signature(13),
    );

    expect(() =>
      deriveRevokeDeviceSecurityState(
        { ...afterAdd, workspaceId: createWorkspaceId() },
        transition,
        head(13),
      ),
    ).toThrow("RevokeDevice does not extend current SecurityState");
  });

  it("rejects self revocation", () => {
    const workspaceId = createWorkspaceId();
    const deviceA = device(40);
    const initial = deriveInitialSecurityState(
      attachCreateWorkspaceSignature(
        createUnsignedCreateWorkspaceTransition(workspaceId, deviceA),
        signature(6),
      ),
      head(6),
    );

    expect(() =>
      createUnsignedRevokeDeviceTransition(
        initial,
        deviceA.deviceId,
        deviceA.deviceId,
      ),
    ).toThrow("A device cannot revoke itself");
  });
});

describe("WorkspaceKey rotation envelope", () => {
  it("encodes deterministically and requires a 64-byte signature", () => {
    const workspaceId = createWorkspaceId();
    const signerDeviceId = createDeviceId();
    const recipientDeviceId = createDeviceId();
    const unsigned = {
      protocolVersion: 1 as const,
      workspaceId,
      keyEpoch: 2,
      securityHead: head(7),
      recipientDeviceId,
      sealedEnvelope: new Uint8Array([1, 2, 3, 4]),
      signerDeviceId,
    };

    const first = encodeUnsignedWorkspaceKeyRotationEnvelope(unsigned);
    const second = encodeUnsignedWorkspaceKeyRotationEnvelope(unsigned);
    expect(first).toEqual(second);

    expect(() =>
      attachWorkspaceKeyRotationEnvelopeSignature(
        unsigned,
        new Uint8Array(63),
      ),
    ).toThrow("signature must be 64 bytes");

    const signed = attachWorkspaceKeyRotationEnvelopeSignature(
      unsigned,
      signature(7),
    );
    expect(signed.signature).toEqual(signature(7));
  });
});
