import {
  destroyDeviceKeyMaterial,
  generateDeviceKeyMaterial,
  sha256,
  signEd25519,
  type DeviceKeyMaterial,
} from "@floe-note/crypto";
import { createProjectId } from "@floe-note/domain";
import {
  attachProjectKeyRotationEnvelopeSignature,
  encodeUnsignedProjectKeyRotationEnvelope,
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

async function createScenario(): Promise<{
  state: SecurityState;
  envelope: ProjectKeyRotationEnvelope;
  localDeviceId: SecurityState["devices"][number]["deviceId"];
  otherDeviceId: SecurityState["devices"][number]["deviceId"];
}> {
  const signer = await generateDeviceKeyMaterial();
  const recipient = await generateDeviceKeyMaterial();
  const addedLater = await generateDeviceKeyMaterial();
  keyMaterials.push(signer, recipient, addedLater);

  const projectId = createProjectId();
  const rotationHead = await sha256(
    new TextEncoder().encode("revoke-device-head"),
  );
  const currentHead = await sha256(
    new TextEncoder().encode("later-add-device-head"),
  );

  // The envelope was created by a RevokeDevice at sequence 3 / epoch 2.
  const unsignedEnvelope = {
    protocolVersion: 1 as const,
    projectId,
    keyEpoch: 2,
    securityHead: rotationHead,
    recipientDeviceId: recipient.publicIdentity.deviceId,
    sealedEnvelope: new Uint8Array([0x01, 0x02, 0x03]),
    signerDeviceId: signer.publicIdentity.deviceId,
  };
  const envelope = attachProjectKeyRotationEnvelopeSignature(
    unsignedEnvelope,
    await signEd25519(
      encodeUnsignedProjectKeyRotationEnvelope(unsignedEnvelope),
      signer.signingPrivateKey,
    ),
  );

  // A later AddDevice advances the SecurityState head but keeps epoch 2.
  const state: SecurityState = {
    protocolVersion: 1,
    projectId,
    sequence: 4,
    headHash: currentHead,
    keyEpoch: 2,
    devices: [
      {
        ...signer.publicIdentity,
        addedAtSequence: 0,
      },
      {
        ...recipient.publicIdentity,
        addedAtSequence: 2,
      },
      {
        ...addedLater.publicIdentity,
        addedAtSequence: 4,
      },
    ].sort((left, right) => left.deviceId.localeCompare(right.deviceId)),
  };

  return {
    state,
    envelope,
    localDeviceId: recipient.publicIdentity.deviceId,
    otherDeviceId: addedLater.publicIdentity.deviceId,
  };
}

describe("rotated ProjectKey recovery", () => {
  it("uses the authenticated rotation head after a same-epoch SecurityState update", async () => {
    const { state, envelope, localDeviceId } = await createScenario();

    expect(state.keyEpoch).toBe(envelope.keyEpoch);
    expect(state.headHash).not.toEqual(envelope.securityHead);

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
        stored = { sealedEnvelope, projectId, keyEpoch, securityHead };
      },
    };

    await storeVerifiedRotatedProjectKey(
      session,
      state,
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

  it("still rejects mismatched Project, epoch, and recipient contexts", async () => {
    const { state, envelope, localDeviceId, otherDeviceId } =
      await createScenario();
    const session: Pick<DeviceVaultSession, "storeSealedProjectKey"> = {
      async storeSealedProjectKey() {},
    };

    for (const mismatchedEnvelope of [
      { ...envelope, projectId: createProjectId() },
      { ...envelope, keyEpoch: envelope.keyEpoch + 1 },
      { ...envelope, recipientDeviceId: otherDeviceId },
    ]) {
      await expect(
        storeVerifiedRotatedProjectKey(
          session,
          state,
          localDeviceId,
          mismatchedEnvelope,
        ),
      ).rejects.toThrow(
        "ProjectKey rotation envelope does not match SecurityState",
      );
    }
  });

  it("still authenticates the rotation-time security head", async () => {
    const { state, envelope, localDeviceId } = await createScenario();
    const session: Pick<DeviceVaultSession, "storeSealedProjectKey"> = {
      async storeSealedProjectKey() {},
    };
    const securityHead = envelope.securityHead.slice();
    securityHead[0] = (securityHead[0] ?? 0) ^ 0xff;

    await expect(
      storeVerifiedRotatedProjectKey(session, state, localDeviceId, {
        ...envelope,
        securityHead,
      }),
    ).rejects.toThrow(
      "ProjectKey rotation envelope signature verification failed",
    );
  });

  it("rejects an invalid envelope signature", async () => {
    const { state, envelope, localDeviceId } = await createScenario();
    const session: Pick<DeviceVaultSession, "storeSealedProjectKey"> = {
      async storeSealedProjectKey() {},
    };
    const signature = envelope.signature.slice();
    signature[0] = (signature[0] ?? 0) ^ 0xff;

    await expect(
      storeVerifiedRotatedProjectKey(session, state, localDeviceId, {
        ...envelope,
        signature,
      }),
    ).rejects.toThrow(
      "ProjectKey rotation envelope signature verification failed",
    );
  });
});
