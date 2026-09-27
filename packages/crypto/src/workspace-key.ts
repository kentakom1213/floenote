import {
  parseDeviceId,
  parseWorkspaceId,
  type DeviceId,
  type WorkspaceId,
} from "@floe-note/domain";
import sodium from "libsodium-wrappers";

import {
  DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES,
  DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
} from "./device-keys.js";
import { SHA256_BYTES } from "./security-crypto.js";

export const WORKSPACE_KEY_BYTES = 32;
export const WORKSPACE_KEY_ENVELOPE_VERSION = 1 as const;

export type WorkspaceKeyEnvelopeContext = {
  workspaceId: WorkspaceId;
  keyEpoch: number;
  recipientDeviceId: DeviceId;
  securityHead: Uint8Array;
};

type SerializedWorkspaceKeyEnvelope = {
  version: typeof WORKSPACE_KEY_ENVELOPE_VERSION;
  workspaceId: string;
  keyEpoch: number;
  recipientDeviceId: string;
  securityHead: string;
  workspaceKey: string;
};

export async function generateWorkspaceKey(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(WORKSPACE_KEY_BYTES);
}

export async function sealWorkspaceKeyForDevice(
  context: WorkspaceKeyEnvelopeContext,
  workspaceKey: Uint8Array,
  recipientEncryptionPublicKey: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  validateContext(context);
  assertLength(workspaceKey, WORKSPACE_KEY_BYTES, "WorkspaceKey");
  assertLength(
    recipientEncryptionPublicKey,
    DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
    "recipient encryption public key",
  );

  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      version: WORKSPACE_KEY_ENVELOPE_VERSION,
      workspaceId: context.workspaceId,
      keyEpoch: context.keyEpoch,
      recipientDeviceId: context.recipientDeviceId,
      securityHead: bytesToHex(context.securityHead),
      workspaceKey: bytesToHex(workspaceKey),
    } satisfies SerializedWorkspaceKeyEnvelope),
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

export async function openSealedWorkspaceKeyForDevice(
  sealedEnvelope: Uint8Array,
  expected: WorkspaceKeyEnvelopeContext,
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
    throw new Error("Could not open WorkspaceKey envelope");
  }

  try {
    const parsed = parseEnvelope(plaintext);
    if (
      parsed.workspaceId !== expected.workspaceId ||
      parsed.keyEpoch !== expected.keyEpoch ||
      parsed.recipientDeviceId !== expected.recipientDeviceId ||
      !bytesEqual(parsed.securityHead, expected.securityHead)
    ) {
      parsed.workspaceKey.fill(0);
      throw new Error("WorkspaceKey envelope context does not match pairing");
    }

    return parsed.workspaceKey;
  } finally {
    sodium.memzero(plaintext);
  }
}

function parseEnvelope(plaintext: Uint8Array): {
  workspaceId: WorkspaceId;
  keyEpoch: number;
  recipientDeviceId: DeviceId;
  securityHead: Uint8Array;
  workspaceKey: Uint8Array;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Invalid WorkspaceKey envelope");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== WORKSPACE_KEY_ENVELOPE_VERSION ||
    !("workspaceId" in parsed) ||
    typeof parsed.workspaceId !== "string" ||
    !("keyEpoch" in parsed) ||
    typeof parsed.keyEpoch !== "number" ||
    !Number.isSafeInteger(parsed.keyEpoch) ||
    parsed.keyEpoch < 1 ||
    !("recipientDeviceId" in parsed) ||
    typeof parsed.recipientDeviceId !== "string" ||
    !("securityHead" in parsed) ||
    typeof parsed.securityHead !== "string" ||
    !("workspaceKey" in parsed) ||
    typeof parsed.workspaceKey !== "string"
  ) {
    throw new Error("Invalid WorkspaceKey envelope");
  }

  return {
    workspaceId: parseWorkspaceId(parsed.workspaceId),
    keyEpoch: parsed.keyEpoch,
    recipientDeviceId: parseDeviceId(parsed.recipientDeviceId),
    securityHead: hexToBytes(parsed.securityHead, SHA256_BYTES, "security head"),
    workspaceKey: hexToBytes(parsed.workspaceKey, WORKSPACE_KEY_BYTES, "WorkspaceKey"),
  };
}

function validateContext(context: WorkspaceKeyEnvelopeContext): void {
  if (!Number.isSafeInteger(context.keyEpoch) || context.keyEpoch < 1) {
    throw new TypeError("WorkspaceKey epoch must be a positive safe integer");
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
