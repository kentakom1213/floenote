import type { DeviceId } from "@floe-note/domain";
import { encode, rfc8949EncodeOptions } from "cborg";

import {
  SECURITY_HEAD_HASH_BYTES,
  SECURITY_SIGNATURE_BYTES,
} from "./create-workspace.js";
import {
  SECURITY_PROTOCOL_VERSION,
  type SecurityState,
} from "./state.js";
import type {
  RevokeDeviceTransition,
  UnsignedRevokeDeviceTransition,
} from "./transition.js";

export function createUnsignedRevokeDeviceTransition(
  currentState: SecurityState,
  revokedDeviceId: DeviceId,
  signerDeviceId: DeviceId,
): UnsignedRevokeDeviceTransition {
  validateCurrentStateForRevoke(
    currentState,
    revokedDeviceId,
    signerDeviceId,
  );

  return {
    type: "revoke-device",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId: currentState.workspaceId,
    sequence: currentState.sequence + 1,
    previousHash: currentState.headHash.slice(),
    revokedDeviceId,
    newKeyEpoch: currentState.keyEpoch + 1,
    signerDeviceId,
  };
}

export function attachRevokeDeviceSignature(
  transition: UnsignedRevokeDeviceTransition,
  signature: Uint8Array,
): RevokeDeviceTransition {
  if (signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `RevokeDevice signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
    );
  }

  return {
    ...cloneUnsignedRevokeDeviceTransition(transition),
    signature: signature.slice(),
  };
}

export function encodeUnsignedRevokeDeviceTransition(
  transition: UnsignedRevokeDeviceTransition,
): Uint8Array {
  return encode(createUnsignedWireValue(transition), rfc8949EncodeOptions);
}

export function encodeRevokeDeviceTransition(
  transition: RevokeDeviceTransition,
): Uint8Array {
  if (transition.signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `RevokeDevice signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
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

export function deriveRevokeDeviceSecurityState(
  currentState: SecurityState,
  transition: RevokeDeviceTransition,
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
    workspaceId: currentState.workspaceId,
    sequence: transition.sequence,
    headHash: headHash.slice(),
    keyEpoch: transition.newKeyEpoch,
    devices: currentState.devices
      .filter((device) => device.deviceId !== transition.revokedDeviceId)
      .map((device) => ({
        deviceId: device.deviceId,
        encryptionPublicKey: device.encryptionPublicKey.slice(),
        signingPublicKey: device.signingPublicKey.slice(),
        addedAtSequence: device.addedAtSequence,
      })),
  };
}

function validateCurrentStateForRevoke(
  currentState: SecurityState,
  revokedDeviceId: DeviceId,
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
  if (
    !Number.isSafeInteger(currentState.keyEpoch) ||
    currentState.keyEpoch < 1 ||
    currentState.keyEpoch === Number.MAX_SAFE_INTEGER
  ) {
    throw new TypeError("Security key epoch is exhausted");
  }
  if (currentState.headHash.byteLength !== SECURITY_HEAD_HASH_BYTES) {
    throw new TypeError("Invalid current security head hash");
  }
  if (!currentState.devices.some((device) => device.deviceId === signerDeviceId)) {
    throw new TypeError("RevokeDevice signer is not authorized");
  }
  if (!currentState.devices.some((device) => device.deviceId === revokedDeviceId)) {
    throw new TypeError("Revoked device is not authorized");
  }
  if (revokedDeviceId === signerDeviceId) {
    throw new TypeError("A device cannot revoke itself");
  }
}

function validateTransitionAgainstCurrentState(
  currentState: SecurityState,
  transition: RevokeDeviceTransition,
): void {
  validateCurrentStateForRevoke(
    currentState,
    transition.revokedDeviceId,
    transition.signerDeviceId,
  );

  if (
    transition.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    transition.workspaceId !== currentState.workspaceId ||
    transition.sequence !== currentState.sequence + 1 ||
    transition.newKeyEpoch !== currentState.keyEpoch + 1 ||
    !bytesEqual(transition.previousHash, currentState.headHash)
  ) {
    throw new TypeError("RevokeDevice does not extend current SecurityState");
  }
}

function createUnsignedWireValue(
  transition: UnsignedRevokeDeviceTransition,
): {
  type: "revoke-device";
  protocolVersion: 1;
  workspaceId: string;
  sequence: number;
  previousHash: Uint8Array;
  revokedDeviceId: string;
  newKeyEpoch: number;
  signerDeviceId: string;
} {
  if (
    transition.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    !Number.isSafeInteger(transition.sequence) ||
    transition.sequence < 1 ||
    transition.previousHash.byteLength !== SECURITY_HEAD_HASH_BYTES ||
    !Number.isSafeInteger(transition.newKeyEpoch) ||
    transition.newKeyEpoch < 2
  ) {
    throw new TypeError("Invalid RevokeDevice transition");
  }

  return {
    type: "revoke-device",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId: transition.workspaceId,
    sequence: transition.sequence,
    previousHash: transition.previousHash,
    revokedDeviceId: transition.revokedDeviceId,
    newKeyEpoch: transition.newKeyEpoch,
    signerDeviceId: transition.signerDeviceId,
  };
}

function cloneUnsignedRevokeDeviceTransition(
  transition: UnsignedRevokeDeviceTransition,
): UnsignedRevokeDeviceTransition {
  return {
    ...transition,
    previousHash: transition.previousHash.slice(),
  };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
