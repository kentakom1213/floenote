import {
  parseDeviceId,
  parseProjectId,
  type ProjectId,
} from "@floe-note/domain";

import {
  SECURITY_HEAD_HASH_BYTES,
  SECURITY_SIGNATURE_BYTES,
} from "./create-project.js";
import {
  SECURITY_PROTOCOL_VERSION,
  type AuthorizedDevice,
  type SecurityState,
} from "./state.js";
import type { CreateProjectTransition } from "./transition.js";

const DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES = 32;
const DEVICE_SIGNING_PUBLIC_KEY_BYTES = 32;

export type CreateProjectWirePayload = {
  type: "create-project";
  protocolVersion: 1;
  projectId: string;
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

export type SecurityStateWirePayload = {
  protocolVersion: 1;
  projectId: string;
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

export function createProjectTransitionToWire(
  transition: CreateProjectTransition,
): CreateProjectWirePayload {
  return {
    type: "create-project",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    projectId: transition.projectId,
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

export function parseCreateProjectWirePayload(
  value: unknown,
  expectedProjectId?: ProjectId,
): CreateProjectTransition {
  if (!isRecord(value)) {
    throw new TypeError("Invalid CreateProject payload");
  }

  if (
    value.type !== "create-project" ||
    value.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    value.sequence !== 0 ||
    value.previousHash !== null ||
    value.keyEpoch !== 1 ||
    typeof value.projectId !== "string" ||
    !isRecord(value.initialDevice) ||
    typeof value.initialDevice.deviceId !== "string" ||
    typeof value.initialDevice.encryptionPublicKey !== "string" ||
    typeof value.initialDevice.signingPublicKey !== "string" ||
    typeof value.signature !== "string"
  ) {
    throw new TypeError("Invalid CreateProject payload");
  }

  const projectId = parseProjectId(value.projectId);
  if (expectedProjectId && projectId !== expectedProjectId) {
    throw new TypeError("CreateProject ProjectId does not match request route");
  }

  return {
    type: "create-project",
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    projectId,
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
      "CreateProject signature",
    ),
  };
}

export function securityStateToWire(
  state: SecurityState,
): SecurityStateWirePayload {
  return {
    protocolVersion: state.protocolVersion,
    projectId: state.projectId,
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
  expectedProjectId?: ProjectId,
): SecurityState {
  if (
    !isRecord(value) ||
    value.protocolVersion !== SECURITY_PROTOCOL_VERSION ||
    typeof value.projectId !== "string" ||
    !Number.isSafeInteger(value.sequence) ||
    typeof value.headHash !== "string" ||
    !Number.isSafeInteger(value.keyEpoch) ||
    !Array.isArray(value.devices)
  ) {
    throw new TypeError("Invalid SecurityState payload");
  }

  const projectId = parseProjectId(value.projectId);
  if (expectedProjectId && projectId !== expectedProjectId) {
    throw new TypeError("SecurityState ProjectId does not match request route");
  }

  const sequence = value.sequence as number;
  const keyEpoch = value.keyEpoch as number;
  if (sequence < 0 || keyEpoch < 1) {
    throw new TypeError("Invalid SecurityState counters");
  }

  const devices = value.devices.map(parseAuthorizedDevice);

  return {
    protocolVersion: SECURITY_PROTOCOL_VERSION,
    projectId,
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

    output += BASE64URL_ALPHABET[(chunk >>> 18) & 63];
    output += BASE64URL_ALPHABET[(chunk >>> 12) & 63];
    if (second !== undefined) {
      output += BASE64URL_ALPHABET[(chunk >>> 6) & 63];
    }
    if (third !== undefined) {
      output += BASE64URL_ALPHABET[chunk & 63];
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

  if (outputIndex !== output.length || output.byteLength !== expectedBytes) {
    throw new TypeError(
      `${label} must be ${expectedBytes} bytes`,
    );
  }

  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
