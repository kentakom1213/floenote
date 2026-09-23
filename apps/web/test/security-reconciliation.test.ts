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
  createUnsignedAddDeviceTransition,
  createUnsignedCreateProjectTransition,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  encodeAddDeviceTransition,
  encodeCreateProjectTransition,
  encodeUnsignedAddDeviceTransition,
  encodeUnsignedCreateProjectTransition,
  type SecurityState,
} from "@floe-note/security";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reconcileVerifiedSecurityState,
  type SecurityStateCoordinatorReader,
} from "../src/security-reconciliation.js";

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

describe("SecurityState coordinator reconciliation", () => {
  it("accepts an unchanged coordinator state without fetching transitions", async () => {
    const device = await generateDeviceKeyMaterial();
    keyMaterials.push(device);
    const storedState = await createInitialState(device);
    const getSecurityTransitions = vi.fn(async () => []);

    const coordinator: SecurityStateCoordinatorReader = {
      getSecurityState: vi.fn(async () => storedState),
      getSecurityTransitions,
    };

    await expect(
      reconcileVerifiedSecurityState(coordinator, storedState),
    ).resolves.toBe(storedState);
    expect(getSecurityTransitions).not.toHaveBeenCalled();
  });

  it("verifies signed transitions before adopting a newer state", async () => {
    const deviceA = await generateDeviceKeyMaterial();
    const deviceB = await generateDeviceKeyMaterial();
    keyMaterials.push(deviceA, deviceB);
    const storedState = await createInitialState(deviceA);

    const unsignedAdd = createUnsignedAddDeviceTransition(
      storedState,
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
    const coordinatorState = deriveAddDeviceSecurityState(
      storedState,
      add,
      await sha256(encodeAddDeviceTransition(add)),
    );

    const coordinator: SecurityStateCoordinatorReader = {
      getSecurityState: vi.fn(async () => coordinatorState),
      getSecurityTransitions: vi.fn(async () => [add]),
    };

    await expect(
      reconcileVerifiedSecurityState(coordinator, storedState),
    ).resolves.toEqual(coordinatorState);
    expect(coordinator.getSecurityTransitions).toHaveBeenCalledWith(
      storedState.projectId,
      storedState.sequence,
    );
  });

  it("rejects coordinator rollback without changing the local state", async () => {
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
    const storedState = deriveAddDeviceSecurityState(
      initial,
      add,
      await sha256(encodeAddDeviceTransition(add)),
    );

    const coordinator: SecurityStateCoordinatorReader = {
      getSecurityState: vi.fn(async () => initial),
      getSecurityTransitions: vi.fn(async () => []),
    };

    await expect(
      reconcileVerifiedSecurityState(coordinator, storedState),
    ).rejects.toThrow(
      "Coordinator SecurityState is older than the locally verified state",
    );
  });

  it("rejects a materialized state that does not match verified history", async () => {
    const device = await generateDeviceKeyMaterial();
    keyMaterials.push(device);
    const storedState = await createInitialState(device);
    const mismatchedState: SecurityState = {
      ...storedState,
      headHash: new Uint8Array(storedState.headHash.length).fill(0x42),
    };

    const coordinator: SecurityStateCoordinatorReader = {
      getSecurityState: vi.fn(async () => mismatchedState),
      getSecurityTransitions: vi.fn(async () => []),
    };

    await expect(
      reconcileVerifiedSecurityState(coordinator, storedState),
    ).rejects.toThrow(
      "Verified SecurityState does not match the coordinator current state",
    );
  });
});
