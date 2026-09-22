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

function bytesToBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(
  value: string,
  expectedBytes: number,
  label: string,
): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError(`Invalid ${label}`);
  }

  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new TypeError(`Invalid ${label}`);
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== expectedBytes) {
    throw new TypeError(
      `${label} must be ${expectedBytes} bytes`,
    );
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
