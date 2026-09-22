import type { DeviceId } from "@floe-note/domain";
import { encode, rfc8949EncodeOptions } from "cborg";

import {
  SECURITY_HEAD_HASH_BYTES,
  SECURITY_SIGNATURE_BYTES,
} from "./create-project.js";
import {
  SECURITY_PROTOCOL_VERSION,
  type DevicePublicIdentity,
  type SecurityState,
} from "./state.js";
import type {
  AddDeviceTransition,
  UnsignedAddDeviceTransition,
} from "./transition.js";

export function createUnsignedAddDeviceTransition(
  currentState: SecurityState,
  newDevice: DevicePublicIdentity,
  signerDeviceId: DeviceId,
): UnsignedAddDeviceTransition {
  validateCurrentStateForAdd(currentState, newDevice, signerDeviceId);

  return {
    type: "add-device",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    projectId: currentState.projectId,
    sequence: currentState.sequence + 1,
    previousHash: currentState.headHash.slice(),
    newDevice: cloneDeviceIdentity(newDevice),
    signerDeviceId,
  };
}

export function attachAddDeviceSignature(
  transition: UnsignedAddDeviceTransition,
  signature: Uint8Array,
): AddDeviceTransition {
  if (signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `AddDevice signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
    );
  }

  return {
    ...cloneUnsignedAddDeviceTransition(transition),
    signature: signature.slice(),
  };
}

export function encodeUnsignedAddDeviceTransition(
  transition: UnsignedAddDeviceTransition,
): Uint8Array {
  return encode(createUnsignedWireValue(transition), rfc8949EncodeOptions);
}

export function encodeAddDeviceTransition(
  transition: AddDeviceTransition,
): Uint8Array {
  if (transition.signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `AddDevice signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
    );
  }

  return encode(
    {
      ...createUnsignedWireValue(transition),
      signature: transition.signature,
    },
    rfc8949EncodeOptions,
  );
}

export function deriveAddDeviceSecurityState(
  currentState: SecurityState,
  transition: AddDeviceTransition,
  headHash: Uint8Array,
): SecurityState {
  if (headHash.byteLength !== SECURITY_HEAD_HASH_BYTES) {
    throw new TypeError(
      `Security head hash must be ${SECURITY_HEAD_HASH_BYTES} bytes`,
    );
  }

  validateTransitionAgainstCurrentState(currentState, transition);

  return {
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    projectId: currentState.projectId,
    sequence: transition.sequence,
    headHash: headHash.slice(),
    keyEpoch: currentState.keyEpoch,
    devices: [
      ...currentState.devices.map(cloneAuthorizedDevice),
      {
        ...cloneDeviceIdentity(transition.newDevice),
        addedAtSequence: transition.sequence,
      },
    ].sort((left, right) => left.deviceId.localeCompare(right.deviceId)),
  };
}

function validateCurrentStateForAdd(
  currentState: SecurityState,
  newDevice: DevicePublicIdentity,
  signerDeviceId: DeviceId,
): void {
  if (currentState.protocolVersion !== SECURITY_PROTOCOL_VERSION) {
    throw new TypeError("Unsupported SecurityState protocol version");
  }
  if (!Number.isSafeInteger(currentState.sequence) || currentState.sequence < 0) {
    throw new TypeError("Invalid current security sequence");
  }
  if (currentState.sequence === Number.MAX_SAFE_INTEGER) {
    throw new TypeError("Security sequence is exhausted");
  }
  if (currentState.headHash.byteLength !== SECURITY_HEAD_HASH_BYTES) {
    throw new TypeError("Invalid current security head hash");
  }
  if (!currentState.devices.some((device) => device.deviceId === signerDeviceId)) {
    throw new TypeError("AddDevice signer is not authorized");
  }
  if (currentState.devices.some((device) => device.deviceId === newDevice.deviceId)) {
    throw new TypeError("Device is already authorized");
  }
}

function validateTransitionAgainstCurrentState(
  currentState: SecurityState,
  transition: AddDeviceTransition,
): void {
  validateCurrentStateForAdd(
    currentState,
    transition.newDevice,
    transition.signerDeviceId,
  );

  if (
    transition.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    transition.projectId !== currentState.projectId ||
    transition.sequence !== currentState.sequence + 1 ||
    !bytesEqual(transition.previousHash, currentState.headHash)
  ) {
    throw new TypeError("AddDevice does not extend current SecurityState");
  }
}

function createUnsignedWireValue(
  transition: UnsignedAddDeviceTransition,
): {
  type: "add-device";
  protocolVersion: 1;
  projectId: string;
  sequence: number;
  previousHash: Uint8Array;
  newDevice: {
    deviceId: string;
    encryptionPublicKey: Uint8Array;
    signingPublicKey: Uint8Array;
  };
  signerDeviceId: string;
} {
  if (
    transition.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    !Number.isSafeInteger(transition.sequence) ||
    transition.sequence < 1 ||
    transition.previousHash.byteLength !== SECURITY_HEAD_HASH_BYTES
  ) {
    throw new TypeError("Invalid AddDevice transition");
  }

  return {
    type: "add-device",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    projectId: transition.projectId,
    sequence: transition.sequence,
    previousHash: transition.previousHash,
    newDevice: {
      deviceId: transition.newDevice.deviceId,
      encryptionPublicKey: transition.newDevice.encryptionPublicKey,
      signingPublicKey: transition.newDevice.signingPublicKey,
    },
    signerDeviceId: transition.signerDeviceId,
  };
}

function cloneUnsignedAddDeviceTransition(
  transition: UnsignedAddDeviceTransition,
): UnsignedAddDeviceTransition {
  return {
    ...transition,
    previousHash: transition.previousHash.slice(),
    newDevice: cloneDeviceIdentity(transition.newDevice),
  };
}

function cloneAuthorizedDevice(
  device: SecurityState["devices"][number],
): SecurityState["devices"][number] {
  return {
    ...cloneDeviceIdentity(device),
    addedAtSequence: device.addedAtSequence,
  };
}

function cloneDeviceIdentity(
  identity: DevicePublicIdentity,
): DevicePublicIdentity {
  return {
    deviceId: identity.deviceId,
    encryptionPublicKey: identity.encryptionPublicKey.slice(),
    signingPublicKey: identity.signingPublicKey.slice(),
  };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
