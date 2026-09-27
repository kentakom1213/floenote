import type { WorkspaceId } from "@floe-note/domain";
import { encode, rfc8949EncodeOptions } from "cborg";

import {
  SECURITY_PROTOCOL_VERSION,
  type DevicePublicIdentity,
  type SecurityState,
} from "./state.js";
import type {
  CreateWorkspaceTransition,
  UnsignedCreateWorkspaceTransition,
} from "./transition.js";

export const SECURITY_HEAD_HASH_BYTES = 32;
export const SECURITY_SIGNATURE_BYTES = 64;

export function createUnsignedCreateWorkspaceTransition(
  workspaceId: WorkspaceId,
  initialDevice: DevicePublicIdentity,
): UnsignedCreateWorkspaceTransition {
  return {
    type: "create-workspace",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId,
    sequence: 0,
    previousHash: null,
    keyEpoch: 1,
    initialDevice: cloneDeviceIdentity(initialDevice),
  };
}

export function attachCreateWorkspaceSignature(
  transition: UnsignedCreateWorkspaceTransition,
  signature: Uint8Array,
): CreateWorkspaceTransition {
  if (signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `CreateWorkspace signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
    );
  }

  return {
    ...cloneUnsignedCreateWorkspaceTransition(transition),
    signature: signature.slice(),
  };
}

export function encodeUnsignedCreateWorkspaceTransition(
  transition: UnsignedCreateWorkspaceTransition,
): Uint8Array {
  return encode(
    createUnsignedWireValue(transition),
    rfc8949EncodeOptions,
  );
}

export function encodeCreateWorkspaceTransition(
  transition: CreateWorkspaceTransition,
): Uint8Array {
  if (transition.signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `CreateWorkspace signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
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

export function deriveInitialSecurityState(
  transition: CreateWorkspaceTransition,
  headHash: Uint8Array,
): SecurityState {
  if (headHash.byteLength !== SECURITY_HEAD_HASH_BYTES) {
    throw new TypeError(
      `Security head hash must be ${SECURITY_HEAD_HASH_BYTES} bytes`,
    );
  }

  return {
    protocolVersion: transition.protocolVersion,
    workspaceId: transition.workspaceId,
    sequence: 0,
    headHash: headHash.slice(),
    keyEpoch: 1,
    devices: [
      {
        ...cloneDeviceIdentity(transition.initialDevice),
        addedAtSequence: 0,
      },
    ],
  };
}

function createUnsignedWireValue(
  transition: UnsignedCreateWorkspaceTransition,
): {
  type: "create-workspace";
  protocolVersion: 1;
  workspaceId: string;
  sequence: 0;
  previousHash: null;
  keyEpoch: 1;
  initialDevice: {
    deviceId: string;
    encryptionPublicKey: Uint8Array;
    signingPublicKey: Uint8Array;
  };
} {
  if (
    transition.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    transition.sequence !== 0 ||
    transition.previousHash !== null ||
    transition.keyEpoch !== 1
  ) {
    throw new TypeError("Invalid CreateWorkspace transition");
  }

  return {
    type: "create-workspace",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId: transition.workspaceId,
    sequence: 0,
    previousHash: null,
    keyEpoch: 1,
    initialDevice: {
      deviceId: transition.initialDevice.deviceId,
      encryptionPublicKey: transition.initialDevice.encryptionPublicKey,
      signingPublicKey: transition.initialDevice.signingPublicKey,
    },
  };
}

function cloneUnsignedCreateWorkspaceTransition(
  transition: UnsignedCreateWorkspaceTransition,
): UnsignedCreateWorkspaceTransition {
  return {
    ...transition,
    initialDevice: cloneDeviceIdentity(transition.initialDevice),
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
