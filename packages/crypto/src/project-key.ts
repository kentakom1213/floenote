import {
  parseDeviceId,
  parseProjectId,
  type DeviceId,
  type ProjectId,
} from "@floe-note/domain";
import sodium from "libsodium-wrappers";

import {
  DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES,
  DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
} from "./device-keys.js";
import { SHA256_BYTES } from "./security-crypto.js";

export const PROJECT_KEY_BYTES = 32;
export const PROJECT_KEY_ENVELOPE_VERSION = 1 as const;

export type ProjectKeyEnvelopeContext = {
  projectId: ProjectId;
  keyEpoch: number;
  recipientDeviceId: DeviceId;
  securityHead: Uint8Array;
};

type SerializedProjectKeyEnvelope = {
  version: typeof PROJECT_KEY_ENVELOPE_VERSION;
  projectId: string;
  keyEpoch: number;
  recipientDeviceId: string;
  securityHead: string;
  projectKey: string;
};

export async function generateProjectKey(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(PROJECT_KEY_BYTES);
}

export async function sealProjectKeyForDevice(
  context: ProjectKeyEnvelopeContext,
  projectKey: Uint8Array,
  recipientEncryptionPublicKey: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  validateContext(context);
  assertLength(projectKey, PROJECT_KEY_BYTES, "ProjectKey");
  assertLength(
    recipientEncryptionPublicKey,
    DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
    "recipient encryption public key",
  );

  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      version: PROJECT_KEY_ENVELOPE_VERSION,
      projectId: context.projectId,
      keyEpoch: context.keyEpoch,
      recipientDeviceId: context.recipientDeviceId,
      securityHead: bytesToHex(context.securityHead),
      projectKey: bytesToHex(projectKey),
    } satisfies SerializedProjectKeyEnvelope),
  );

  try {
    return sodium.crypto_box_seal(
      plaintext,
      recipientEncryptionPublicKey,
    );
  } finally {
    sodium.memzero(plaintext);
  }
}

export async function openSealedProjectKeyForDevice(
  sealedEnvelope: Uint8Array,
  expected: ProjectKeyEnvelopeContext,
  recipientEncryptionPublicKey: Uint8Array,
  recipientEncryptionPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  validateContext(expected);
  assertLength(
    recipientEncryptionPublicKey,
    DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
    "recipient encryption public key",
  );
  assertLength(
    recipientEncryptionPrivateKey,
    DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES,
    "recipient encryption private key",
  );

  let plaintext: Uint8Array;
  try {
    plaintext = sodium.crypto_box_seal_open(
      sealedEnvelope,
      recipientEncryptionPublicKey,
      recipientEncryptionPrivateKey,
    );
  } catch {
    throw new Error("Could not open ProjectKey envelope");
  }

  try {
    const parsed = parseEnvelope(plaintext);
    if (
      parsed.projectId !== expected.projectId ||
      parsed.keyEpoch !== expected.keyEpoch ||
      parsed.recipientDeviceId !== expected.recipientDeviceId ||
      !bytesEqual(parsed.securityHead, expected.securityHead)
    ) {
      parsed.projectKey.fill(0);
      throw new Error("ProjectKey envelope context does not match pairing");
    }

    return parsed.projectKey;
  } finally {
    sodium.memzero(plaintext);
  }
}

function parseEnvelope(plaintext: Uint8Array): {
  projectId: ProjectId;
  keyEpoch: number;
  recipientDeviceId: DeviceId;
  securityHead: Uint8Array;
  projectKey: Uint8Array;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Invalid ProjectKey envelope");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== PROJECT_KEY_ENVELOPE_VERSION ||
    !("projectId" in parsed) ||
    typeof parsed.projectId !== "string" ||
    !("keyEpoch" in parsed) ||
    typeof parsed.keyEpoch !== "number" ||
    !Number.isSafeInteger(parsed.keyEpoch) ||
    parsed.keyEpoch < 1 ||
    !("recipientDeviceId" in parsed) ||
    typeof parsed.recipientDeviceId !== "string" ||
    !("securityHead" in parsed) ||
    typeof parsed.securityHead !== "string" ||
    !("projectKey" in parsed) ||
    typeof parsed.projectKey !== "string"
  ) {
    throw new Error("Invalid ProjectKey envelope");
  }

  return {
    projectId: parseProjectId(parsed.projectId),
    keyEpoch: parsed.keyEpoch,
    recipientDeviceId: parseDeviceId(parsed.recipientDeviceId),
    securityHead: hexToBytes(parsed.securityHead, SHA256_BYTES, "security head"),
    projectKey: hexToBytes(parsed.projectKey, PROJECT_KEY_BYTES, "ProjectKey"),
  };
}

function validateContext(context: ProjectKeyEnvelopeContext): void {
  if (!Number.isSafeInteger(context.keyEpoch) || context.keyEpoch < 1) {
    throw new TypeError("ProjectKey epoch must be a positive safe integer");
  }
  assertLength(context.securityHead, SHA256_BYTES, "security head");
}

function assertLength(
  value: Uint8Array,
  expectedLength: number,
  label: string,
): void {
  if (value.byteLength !== expectedLength) {
    throw new TypeError(
      `${label} must be ${expectedLength} bytes`,
    );
  }
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(
  value: string,
  expectedBytes: number,
  label: string,
): Uint8Array {
  if (
    value.length !== expectedBytes * 2 ||
    !/^[0-9a-f]+$/u.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }

  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
