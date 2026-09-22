import type { ProjectId } from "@floe-note/domain";
import { encode, rfc8949EncodeOptions } from "cborg";

import {
  SECURITY_PROTOCOL_VERSION,
  type DevicePublicIdentity,
  type SecurityState,
} from "./state.js";
import type {
  CreateProjectTransition,
  UnsignedCreateProjectTransition,
} from "./transition.js";

export const SECURITY_HEAD_HASH_BYTES = 32;
export const SECURITY_SIGNATURE_BYTES = 64;

export function createUnsignedCreateProjectTransition(
  projectId: ProjectId,
  initialDevice: DevicePublicIdentity,
): UnsignedCreateProjectTransition {
  return {
    type: "create-project",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    projectId,
    sequence: 0,
    previousHash: null,
    keyEpoch: 1,
    initialDevice: cloneDeviceIdentity(initialDevice),
  };
}

export function attachCreateProjectSignature(
  transition: UnsignedCreateProjectTransition,
  signature: Uint8Array,
): CreateProjectTransition {
  if (signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `CreateProject signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
    );
  }

  return {
    ...cloneUnsignedCreateProjectTransition(transition),
    signature: signature.slice(),
  };
}

export function encodeUnsignedCreateProjectTransition(
  transition: UnsignedCreateProjectTransition,
): Uint8Array {
  return encode(
    createUnsignedWireValue(transition),
    rfc8949EncodeOptions,
  );
}

export function encodeCreateProjectTransition(
  transition: CreateProjectTransition,
): Uint8Array {
  if (transition.signature.byteLength !== SECURITY_SIGNATURE_BYTES) {
    throw new TypeError(
      `CreateProject signature must be ${SECURITY_SIGNATURE_BYTES} bytes`,
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
  transition: CreateProjectTransition,
  headHash: Uint8Array,
): SecurityState {
  if (headHash.byteLength !== SECURITY_HEAD_HASH_BYTES) {
    throw new TypeError(
      `Security head hash must be ${SECURITY_HEAD_HASH_BYTES} bytes`,
    );
  }

  return {
    protocolVersion: transition.protocolVersion,
    projectId: transition.projectId,
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
  transition: UnsignedCreateProjectTransition,
): {
  type: "create-project";
  protocolVersion: 1;
  projectId: string;
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
    throw new TypeError("Invalid CreateProject transition");
  }

  return {
    type: "create-project",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    projectId: transition.projectId,
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

function cloneUnsignedCreateProjectTransition(
  transition: UnsignedCreateProjectTransition,
): UnsignedCreateProjectTransition {
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
