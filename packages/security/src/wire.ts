import {
  parseDeviceId,
  parseWorkspaceId,
  type WorkspaceId,
} from "@floe-note/domain";

import {
  SECURITY_HEAD_HASH_BYTES,
  SECURITY_SIGNATURE_BYTES,
} from "./create-workspace.js";
import {
  SECURITY_PROTOCOL_VERSION,
  type AuthorizedDevice,
  type SecurityState,
} from "./state.js";
import type {
  AddDeviceTransition,
  CreateWorkspaceTransition,
  RevokeDeviceTransition,
  SecurityTransition,
} from "./transition.js";

const DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES = 32;
const DEVICE_SIGNING_PUBLIC_KEY_BYTES = 32;

export type CreateWorkspaceWirePayload = {
  type: "create-workspace";
  protocolVersion: 1;
  workspaceId: string;
  sequence: 0;
  previousHash: null;
  keyEpoch: 1;
  initialDevice: {
    deviceId: string;
    encryptionPublicKey: string;
    signingPublicKey: string;
  };
  signature: string;
};

export type AddDeviceWirePayload = {
  type: "add-device";
  protocolVersion: 1;
  workspaceId: string;
  sequence: number;
  previousHash: string;
  newDevice: {
    deviceId: string;
    encryptionPublicKey: string;
    signingPublicKey: string;
  };
  signerDeviceId: string;
  signature: string;
};

export type RevokeDeviceWirePayload = {
  type: "revoke-device";
  protocolVersion: 1;
  workspaceId: string;
  sequence: number;
  previousHash: string;
  revokedDeviceId: string;
  newKeyEpoch: number;
  signerDeviceId: string;
  signature: string;
};

export type SecurityTransitionWirePayload =
  | CreateWorkspaceWirePayload
  | AddDeviceWirePayload
  | RevokeDeviceWirePayload;

export type SecurityStateWirePayload = {
  protocolVersion: 1;
  workspaceId: string;
  sequence: number;
  headHash: string;
  keyEpoch: number;
  devices: Array<{
    deviceId: string;
    encryptionPublicKey: string;
    signingPublicKey: string;
    addedAtSequence: number;
  }>;
};

export function createWorkspaceTransitionToWire(
  transition: CreateWorkspaceTransition,
): CreateWorkspaceWirePayload {
  return {
    type: "create-workspace",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId: transition.workspaceId,
    sequence: 0,
    previousHash: null,
    keyEpoch: 1,
    initialDevice: {
      deviceId: transition.initialDevice.deviceId,
      encryptionPublicKey: bytesToBase64Url(
        transition.initialDevice.encryptionPublicKey,
      ),
      signingPublicKey: bytesToBase64Url(
        transition.initialDevice.signingPublicKey,
      ),
    },
    signature: bytesToBase64Url(transition.signature),
  };
}

export function parseCreateWorkspaceWirePayload(
  value: unknown,
  expectedWorkspaceId?: WorkspaceId,
): CreateWorkspaceTransition {
  if (!isRecord(value)) {
    throw new TypeError("Invalid CreateWorkspace payload");
  }

  if (
    value.type !== "create-workspace" ||
    value.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    value.sequence !== 0 ||
    value.previousHash !== null ||
    value.keyEpoch !== 1 ||
    typeof value.workspaceId !== "string" ||
    !isRecord(value.initialDevice) ||
    typeof value.initialDevice.deviceId !== "string" ||
    typeof value.initialDevice.encryptionPublicKey !== "string" ||
    typeof value.initialDevice.signingPublicKey !== "string" ||
    typeof value.signature !== "string"
  ) {
    throw new TypeError("Invalid CreateWorkspace payload");
  }

  const workspaceId = parseWorkspaceId(value.workspaceId);
  if (expectedWorkspaceId && workspaceId !== expectedWorkspaceId) {
    throw new TypeError("CreateWorkspace WorkspaceId does not match request route");
  }

  return {
    type: "create-workspace",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId,
    sequence: 0,
    previousHash: null,
    keyEpoch: 1,
    initialDevice: {
      deviceId: parseDeviceId(value.initialDevice.deviceId),
      encryptionPublicKey: base64UrlToBytes(
        value.initialDevice.encryptionPublicKey,
        DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
        "device encryption public key",
      ),
      signingPublicKey: base64UrlToBytes(
        value.initialDevice.signingPublicKey,
        DEVICE_SIGNING_PUBLIC_KEY_BYTES,
        "device signing public key",
      ),
    },
    signature: base64UrlToBytes(
      value.signature,
      SECURITY_SIGNATURE_BYTES,
      "CreateWorkspace signature",
    ),
  };
}

export function addDeviceTransitionToWire(
  transition: AddDeviceTransition,
): AddDeviceWirePayload {
  return {
    type: "add-device",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId: transition.workspaceId,
    sequence: transition.sequence,
    previousHash: bytesToBase64Url(transition.previousHash),
    newDevice: {
      deviceId: transition.newDevice.deviceId,
      encryptionPublicKey: bytesToBase64Url(
        transition.newDevice.encryptionPublicKey,
      ),
      signingPublicKey: bytesToBase64Url(
        transition.newDevice.signingPublicKey,
      ),
    },
    signerDeviceId: transition.signerDeviceId,
    signature: bytesToBase64Url(transition.signature),
  };
}

export function parseAddDeviceWirePayload(
  value: unknown,
  expectedWorkspaceId?: WorkspaceId,
): AddDeviceTransition {
  if (
    !isRecord(value) ||
    value.type !== "add-device" ||
    value.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    typeof value.workspaceId !== "string" ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.previousHash !== "string" ||
    !isRecord(value.newDevice) ||
    typeof value.newDevice.deviceId !== "string" ||
    typeof value.newDevice.encryptionPublicKey !== "string" ||
    typeof value.newDevice.signingPublicKey !== "string" ||
    typeof value.signerDeviceId !== "string" ||
    typeof value.signature !== "string"
  ) {
    throw new TypeError("Invalid AddDevice payload");
  }

  const workspaceId = parseWorkspaceId(value.workspaceId);
  if (expectedWorkspaceId && workspaceId !== expectedWorkspaceId) {
    throw new TypeError("AddDevice WorkspaceId does not match request route");
  }

  return {
    type: "add-device",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId,
    sequence: value.sequence,
    previousHash: base64UrlToBytes(
      value.previousHash,
      SECURITY_HEAD_HASH_BYTES,
      "previous security head hash",
    ),
    newDevice: {
      deviceId: parseDeviceId(value.newDevice.deviceId),
      encryptionPublicKey: base64UrlToBytes(
        value.newDevice.encryptionPublicKey,
        DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
        "device encryption public key",
      ),
      signingPublicKey: base64UrlToBytes(
        value.newDevice.signingPublicKey,
        DEVICE_SIGNING_PUBLIC_KEY_BYTES,
        "device signing public key",
      ),
    },
    signerDeviceId: parseDeviceId(value.signerDeviceId),
    signature: base64UrlToBytes(
      value.signature,
      SECURITY_SIGNATURE_BYTES,
      "AddDevice signature",
    ),
  };
}

export function revokeDeviceTransitionToWire(
  transition: RevokeDeviceTransition,
): RevokeDeviceWirePayload {
  return {
    type: "revoke-device",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId: transition.workspaceId,
    sequence: transition.sequence,
    previousHash: bytesToBase64Url(transition.previousHash),
    revokedDeviceId: transition.revokedDeviceId,
    newKeyEpoch: transition.newKeyEpoch,
    signerDeviceId: transition.signerDeviceId,
    signature: bytesToBase64Url(transition.signature),
  };
}

export function parseRevokeDeviceWirePayload(
  value: unknown,
  expectedWorkspaceId?: WorkspaceId,
): RevokeDeviceTransition {
  if (
    !isRecord(value) ||
    value.type !== "revoke-device" ||
    value.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    typeof value.workspaceId !== "string" ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.previousHash !== "string" ||
    typeof value.revokedDeviceId !== "string" ||
    typeof value.newKeyEpoch !== "number" ||
    !Number.isSafeInteger(value.newKeyEpoch) ||
    value.newKeyEpoch < 2 ||
    typeof value.signerDeviceId !== "string" ||
    typeof value.signature !== "string"
  ) {
    throw new TypeError("Invalid RevokeDevice payload");
  }

  const workspaceId = parseWorkspaceId(value.workspaceId);
  if (expectedWorkspaceId && workspaceId !== expectedWorkspaceId) {
    throw new TypeError("RevokeDevice WorkspaceId does not match request route");
  }

  return {
    type: "revoke-device",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId,
    sequence: value.sequence,
    previousHash: base64UrlToBytes(
      value.previousHash,
      SECURITY_HEAD_HASH_BYTES,
      "previous security head hash",
    ),
    revokedDeviceId: parseDeviceId(value.revokedDeviceId),
    newKeyEpoch: value.newKeyEpoch,
    signerDeviceId: parseDeviceId(value.signerDeviceId),
    signature: base64UrlToBytes(
      value.signature,
      SECURITY_SIGNATURE_BYTES,
      "RevokeDevice signature",
    ),
  };
}

export function securityTransitionToWire(
  transition: SecurityTransition,
): SecurityTransitionWirePayload {
  switch (transition.type) {
    case "create-workspace":
      return createWorkspaceTransitionToWire(transition);
    case "add-device":
      return addDeviceTransitionToWire(transition);
    case "revoke-device":
      return revokeDeviceTransitionToWire(transition);
  }
}

export function parseSecurityTransitionWirePayload(
  value: unknown,
  expectedWorkspaceId?: WorkspaceId,
): SecurityTransition {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new TypeError("Invalid SecurityTransition payload");
  }

  switch (value.type) {
    case "create-workspace":
      return parseCreateWorkspaceWirePayload(value, expectedWorkspaceId);
    case "add-device":
      return parseAddDeviceWirePayload(value, expectedWorkspaceId);
    case "revoke-device":
      return parseRevokeDeviceWirePayload(value, expectedWorkspaceId);
    default:
      throw new TypeError("Unsupported SecurityTransition payload");
  }
}

export function securityStateToWire(
  state: SecurityState,
): SecurityStateWirePayload {
  return {
    protocolVersion: state.protocolVersion,
    workspaceId: state.workspaceId,
    sequence: state.sequence,
    headHash: bytesToBase64Url(state.headHash),
    keyEpoch: state.keyEpoch,
    devices: state.devices.map((device) => ({
      deviceId: device.deviceId,
      encryptionPublicKey: bytesToBase64Url(device.encryptionPublicKey),
      signingPublicKey: bytesToBase64Url(device.signingPublicKey),
      addedAtSequence: device.addedAtSequence,
    })),
  };
}

export function parseSecurityStateWirePayload(
  value: unknown,
  expectedWorkspaceId?: WorkspaceId,
): SecurityState {
  if (
    !isRecord(value) ||
    value.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    typeof value.workspaceId !== "string" ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    typeof value.headHash !== "string" ||
    typeof value.keyEpoch !== "number" ||
    !Number.isSafeInteger(value.keyEpoch) ||
    !Array.isArray(value.devices)
  ) {
    throw new TypeError("Invalid SecurityState payload");
  }

  const workspaceId = parseWorkspaceId(value.workspaceId);
  if (expectedWorkspaceId && workspaceId !== expectedWorkspaceId) {
    throw new TypeError("SecurityState WorkspaceId does not match request route");
  }

  const sequence = value.sequence as number;
  const keyEpoch = value.keyEpoch as number;
  if (sequence < 0 || keyEpoch < 1) {
    throw new TypeError("Invalid SecurityState counters");
  }

  const devices = value.devices.map(parseAuthorizedDevice);

  return {
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    workspaceId,
    sequence,
    headHash: base64UrlToBytes(
      value.headHash,
      SECURITY_HEAD_HASH_BYTES,
      "security head hash",
    ),
    keyEpoch,
    devices,
  };
}

function parseAuthorizedDevice(value: unknown): AuthorizedDevice {
  if (
    !isRecord(value) ||
    typeof value.deviceId !== "string" ||
    typeof value.encryptionPublicKey !== "string" ||
    typeof value.signingPublicKey !== "string" ||
    typeof value.addedAtSequence !== "number" ||
    !Number.isSafeInteger(value.addedAtSequence)
  ) {
    throw new TypeError("Invalid authorized device");
  }

  const addedAtSequence = value.addedAtSequence as number;
  if (addedAtSequence < 0) {
    throw new TypeError("Invalid authorized device sequence");
  }

  return {
    deviceId: parseDeviceId(value.deviceId),
    encryptionPublicKey: base64UrlToBytes(
      value.encryptionPublicKey,
      DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
      "device encryption public key",
    ),
    signingPublicKey: base64UrlToBytes(
      value.signingPublicKey,
      DEVICE_SIGNING_PUBLIC_KEY_BYTES,
      "device signing public key",
    ),
    addedAtSequence,
  };
}

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToBase64Url(value: Uint8Array): string {
  let output = "";

  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] ?? 0;
    const second = value[index + 1];
    const third = value[index + 2];

    const chunk =
      (first << 16) |
      ((second ?? 0) << 8) |
      (third ?? 0);

    output += base64UrlDigit((chunk >>> 18) & 63);
    output += base64UrlDigit((chunk >>> 12) & 63);
    if (second !== undefined) {
      output += base64UrlDigit((chunk >>> 6) & 63);
    }
    if (third !== undefined) {
      output += base64UrlDigit(chunk & 63);
    }
  }

  return output;
}

function base64UrlToBytes(
  value: string,
  expectedBytes: number,
  label: string,
): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new TypeError(`Invalid ${label}`);
  }

  const output = new Uint8Array(Math.floor((value.length * 6) / 8));
  let accumulator = 0;
  let bits = 0;
  let outputIndex = 0;

  for (const character of value) {
    const digit = BASE64URL_ALPHABET.indexOf(character);
    if (digit < 0) {
      throw new TypeError(`Invalid ${label}`);
    }

    accumulator = (accumulator << 6) | digit;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output[outputIndex] = (accumulator >>> bits) & 0xff;
      outputIndex += 1;
      accumulator &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }

  if (
    outputIndex !== output.length ||
    output.byteLength !== expectedBytes ||
    bytesToBase64Url(output) !== value
  ) {
    throw new TypeError(
      `${label} must be ${expectedBytes} canonical base64url bytes`,
    );
  }

  return output;
}

function base64UrlDigit(index: number): string {
  const digit = BASE64URL_ALPHABET[index];
  if (digit === undefined) {
    throw new Error("Invalid base64url digit index");
  }
  return digit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
