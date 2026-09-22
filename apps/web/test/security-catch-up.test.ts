import { createProjectId } from "@floe-note/domain";
import {
  destroyDeviceKeyMaterial,
  generateDeviceKeyMaterial,
  sha256,
  signEd25519,
  type DeviceKeyMaterial,
} from "@floe-note/crypto";
import {
  attachAddDeviceSignature,
  attachCreateProjectSignature,
  attachRevokeDeviceSignature,
  createUnsignedAddDeviceTransition,
  createUnsignedCreateProjectTransition,
  createUnsignedRevokeDeviceTransition,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  encodeAddDeviceTransition,
  encodeCreateProjectTransition,
  encodeRevokeDeviceTransition,
  encodeUnsignedAddDeviceTransition,
  encodeUnsignedCreateProjectTransition,
  encodeUnsignedRevokeDeviceTransition,
} from "@floe-note/security";
import { afterEach, describe, expect, it } from "vitest";

import { applyVerifiedSecurityTransitions } from "../src/security-catch-up.js";

const keyMaterials: DeviceKeyMaterial[] = [];

afterEach(async () => {
  await Promise.all(keyMaterials.splice(0).map(destroyDeviceKeyMaterial));
});

async function createInitialState(device: DeviceKeyMaterial) {
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

describe("SecurityTransition catch-up", () => {
  it("verifies and applies AddDevice followed by RevokeDevice", async () => {
    const deviceA = await generateDeviceKeyMaterial();
    const deviceB = await generateDeviceKeyMaterial();
    keyMaterials.push(deviceA, deviceB);

    const initial = await createInitialState(deviceA);

    const unsignedAdd = createUnsignedAddDeviceTransition(
      initial,
      deviceB.publicIdentity,
      deviceA.publicIdentity.deviceId,
    );
    const add = attachAddDeviceSignature(
      unsignedAdd,
      await signEd25519(
        encodeUnsignedAddDeviceTransition(unsignedAdd),
        deviceA.signingPrivateKey,
      ),
    );
    const afterAdd = deriveAddDeviceSecurityState(
      initial,
      add,
      await sha256(encodeAddDeviceTransition(add)),
    );

    const unsignedRevoke = createUnsignedRevokeDeviceTransition(
      afterAdd,
      deviceB.publicIdentity.deviceId,
      deviceA.publicIdentity.deviceId,
    );
    const revoke = attachRevokeDeviceSignature(
      unsignedRevoke,
      await signEd25519(
        encodeUnsignedRevokeDeviceTransition(unsignedRevoke),
        deviceA.signingPrivateKey,
      ),
    );

    const result = await applyVerifiedSecurityTransitions(
      initial,
      [add, revoke],
    );

    expect(result.sequence).toBe(2);
    expect(result.keyEpoch).toBe(2);
    expect(result.headHash).toEqual(
      await sha256(encodeRevokeDeviceTransition(revoke)),
    );
    expect(result.devices.map((device) => device.deviceId)).toEqual([
      deviceA.publicIdentity.deviceId,
    ]);
  });

  it("fails safely when a transition signature is modified", async () => {
    const deviceA = await generateDeviceKeyMaterial();
    const deviceB = await generateDeviceKeyMaterial();
    keyMaterials.push(deviceA, deviceB);

    const initial = await createInitialState(deviceA);
    const unsignedAdd = createUnsignedAddDeviceTransition(
      initial,
      deviceB.publicIdentity,
      deviceA.publicIdentity.deviceId,
    );
    const add = attachAddDeviceSignature(
      unsignedAdd,
      await signEd25519(
        encodeUnsignedAddDeviceTransition(unsignedAdd),
        deviceA.signingPrivateKey,
      ),
    );
    const invalidSignature = add.signature.slice();
    invalidSignature[0] = (invalidSignature[0] ?? 0) ^ 0xff;

    await expect(
      applyVerifiedSecurityTransitions(initial, [
        {
          ...add,
          signature: invalidSignature,
        },
      ]),
    ).rejects.toThrow("Security transition signature verification failed");
  });
});
