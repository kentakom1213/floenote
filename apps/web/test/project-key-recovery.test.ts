import {
  destroyDeviceKeyMaterial,
  generateDeviceKeyMaterial,
  sha256,
  signEd25519,
  type DeviceKeyMaterial,
} from "@floe-note/crypto";
import { createProjectId, type DeviceId } from "@floe-note/domain";
import {
  attachAddDeviceSignature,
  attachCreateProjectSignature,
  attachProjectKeyRotationEnvelopeSignature,
  attachRevokeDeviceSignature,
  createUnsignedAddDeviceTransition,
  createUnsignedCreateProjectTransition,
  createUnsignedRevokeDeviceTransition,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  deriveRevokeDeviceSecurityState,
  encodeAddDeviceTransition,
  encodeCreateProjectTransition,
  encodeRevokeDeviceTransition,
  encodeUnsignedAddDeviceTransition,
  encodeUnsignedCreateProjectTransition,
  encodeUnsignedProjectKeyRotationEnvelope,
  encodeUnsignedRevokeDeviceTransition,
  type ProjectKeyRotationEnvelope,
  type SecurityState,
} from "@floe-note/security";
import type { DeviceVaultSession } from "@floe-note/vault";
import { afterEach, describe, expect, it } from "vitest";

import { storeVerifiedRotatedProjectKey } from "../src/project-key-recovery.js";

const keyMaterials: DeviceKeyMaterial[] = [];

afterEach(async () => {
  await Promise.all(keyMaterials.splice(0).map(destroyDeviceKeyMaterial));
});

async function createInitialState(
  device: DeviceKeyMaterial,
): Promise<SecurityState> {
  const unsigned = createUnsignedCreateProjectTransition(
    createProjectId(),
    device.publicIdentity,
  );
  const transition = attachCreateProjectSignature(
    unsigned,
    await signEd25519(
      encodeUnsignedCreateProjectTransition(unsigned),
      device.signingPrivateKey,
    ),
  );

  return deriveInitialSecurityState(
    transition,
    await sha256(encodeCreateProjectTransition(transition)),
  );
}

async function addDevice(
  state: SecurityState,
  device: DeviceKeyMaterial,
  signer: DeviceKeyMaterial,
): Promise<SecurityState> {
  const unsigned = createUnsignedAddDeviceTransition(
    state,
    device.publicIdentity,
    signer.publicIdentity.deviceId,
  );
  const transition = attachAddDeviceSignature(
    unsigned,
    await signEd25519(
      encodeUnsignedAddDeviceTransition(unsigned),
      signer.signingPrivateKey,
    ),
  );

  return deriveAddDeviceSecurityState(
    state,
    transition,
    await sha256(encodeAddDeviceTransition(transition)),
  );
}

async function revokeDevice(
  state: SecurityState,
  revokedDeviceId: DeviceId,
  signer: DeviceKeyMaterial,
): Promise<SecurityState> {
  const unsigned = createUnsignedRevokeDeviceTransition(
    state,
    revokedDeviceId,
    signer.publicIdentity.deviceId,
  );
  const transition = attachRevokeDeviceSignature(
    unsigned,
    await signEd25519(
      encodeUnsignedRevokeDeviceTransition(unsigned),
      signer.signingPrivateKey,
    ),
  );

  return deriveRevokeDeviceSecurityState(
    state,
    transition,
    await sha256(encodeRevokeDeviceTransition(transition)),
  );
}

async function createRotationEnvelope(
  state: SecurityState,
  signer: DeviceKeyMaterial,
  recipient: DeviceKeyMaterial,
): Promise<ProjectKeyRotationEnvelope> {
  const unsigned = {
    protocolVersion: 1 as const,
    projectId: state.projectId,
    keyEpoch: state.keyEpoch,
    securityHead: state.headHash,
    recipientDeviceId: recipient.publicIdentity.deviceId,
    sealedEnvelope: new Uint8Array([0x01, 0x02, 0x03]),
    signerDeviceId: signer.publicIdentity.deviceId,
  };

  return attachProjectKeyRotationEnvelopeSignature(
    unsigned,
    await signEd25519(
      encodeUnsignedProjectKeyRotationEnvelope(unsigned),
      signer.signingPrivateKey,
    ),
  );
}

async function createRecoveryScenario(): Promise<{
  currentState: SecurityState;
  envelope: ProjectKeyRotationEnvelope;
  localDeviceId: DeviceId;
  otherDeviceId: DeviceId;
}> {
  const deviceA = await generateDeviceKeyMaterial();
  const deviceB = await generateDeviceKeyMaterial();
  const deviceC = await generateDeviceKeyMaterial();
  const deviceD = await generateDeviceKeyMaterial();
  keyMaterials.push(deviceA, deviceB, deviceC, deviceD);

  let state = await createInitialState(deviceA);
  state = await addDevice(state, deviceB, deviceA);
  state = await addDevice(state, deviceC, deviceA);

  const rotatedState = await revokeDevice(
    state,
    deviceB.publicIdentity.deviceId,
    deviceA,
  );
  const envelope = await createRotationEnvelope(
    rotatedState,
    deviceA,
    deviceC,
  );

  const currentState = await addDevice(rotatedState, deviceD, deviceA);

  return {
    currentState,
    envelope,
    localDeviceId: deviceC.publicIdentity.deviceId,
    otherDeviceId: deviceD.publicIdentity.deviceId,
  };
}

describe("rotated ProjectKey recovery", () => {
  it("accepts a valid envelope after the SecurityState head advances within the same key epoch", async () => {
    const { currentState, envelope, localDeviceId } =
      await createRecoveryScenario();

    expect(currentState.keyEpoch).toBe(envelope.keyEpoch);
    expect(currentState.headHash).not.toEqual(envelope.securityHead);

    let stored:
      | {
          sealedEnvelope: Uint8Array;
          projectId: string;
          keyEpoch: number;
          securityHead: Uint8Array;
        }
      | undefined;

    const session: Pick<DeviceVaultSession, "storeSealedProjectKey"> = {
      async storeSealedProjectKey(
        sealedEnvelope,
        projectId,
        keyEpoch,
        securityHead,
      ) {
        stored = {
          sealedEnvelope,
          projectId,
          keyEpoch,
          securityHead,
        };
      },
    };

    await storeVerifiedRotatedProjectKey(
      session,
      currentState,
      localDeviceId,
      envelope,
    );

    expect(stored).toEqual({
      sealedEnvelope: envelope.sealedEnvelope,
      projectId: envelope.projectId,
      keyEpoch: envelope.keyEpoch,
      securityHead: envelope.securityHead,
    });
  });

  it("rejects mismatched Project, key epoch, and recipient contexts", async () => {
    const { currentState, envelope, localDeviceId, otherDeviceId } =
      await createRecoveryScenario();
    const session: Pick<DeviceVaultSession, "storeSealedProjectKey"> = {
      async storeSealedProjectKey() {},
    };

    await expect(
      storeVerifiedRotatedProjectKey(session, currentState, localDeviceId, {
        ...envelope,
        projectId: createProjectId(),
      }),
    ).rejects.toThrow("ProjectKey rotation envelope does not match SecurityState");

    await expect(
      storeVerifiedRotatedProjectKey(session, currentState, localDeviceId, {
        ...envelope,
        keyEpoch: envelope.keyEpoch + 1,
      }),
    ).rejects.toThrow("ProjectKey rotation envelope does not match SecurityState");

    await expect(
      storeVerifiedRotatedProjectKey(session, currentState, localDeviceId, {
        ...envelope,
        recipientDeviceId: otherDeviceId,
      }),
    ).rejects.toThrow("ProjectKey rotation envelope does not match SecurityState");
  });

  it("rejects a tampered rotation-time security head", async () => {
    const { currentState, envelope, localDeviceId } =
      await createRecoveryScenario();
    const session: Pick<DeviceVaultSession, "storeSealedProjectKey"> = {
      async storeSealedProjectKey() {},
    };

    const securityHead = envelope.securityHead.slice();
    securityHead[0] = (securityHead[0] ?? 0) ^ 0xff;

    await expect(
      storeVerifiedRotatedProjectKey(session, currentState, localDeviceId, {
        ...envelope,
        securityHead,
      }),
    ).rejects.toThrow(
      "ProjectKey rotation envelope signature verification failed",
    );
  });
});
