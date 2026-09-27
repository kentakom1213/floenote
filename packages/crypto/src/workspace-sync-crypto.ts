import type { WorkspaceId } from "@floe-note/domain";
import sodium from "libsodium-wrappers";

import { PROJECT_KEY_BYTES } from "./workspace-key.js";

export const PROJECT_SYNC_ENVELOPE_VERSION = 1 as const;

const MAGIC = Uint8Array.of(0x46, 0x4c, 0x4f, 0x45); // "FLOE"
const VERSION_OFFSET = MAGIC.byteLength;
const KEY_EPOCH_OFFSET = VERSION_OFFSET + 1;
const KEY_EPOCH_BYTES = 8;
const NONCE_OFFSET = KEY_EPOCH_OFFSET + KEY_EPOCH_BYTES;
const NONCE_BYTES = 24;
const HEADER_BYTES = NONCE_OFFSET + NONCE_BYTES;
const AAD_CONTEXT = "floe-note/workspace-sync/v1";

export async function encryptWorkspaceSyncPayload(
  workspaceId: WorkspaceId,
  keyEpoch: number,
  workspaceKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  assertWorkspaceKey(workspaceKey);
  assertKeyEpoch(keyEpoch);

  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const aad = createAad(workspaceId, keyEpoch);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    workspaceKey,
  );

  const envelope = new Uint8Array(HEADER_BYTES + ciphertext.byteLength);
  envelope.set(MAGIC, 0);
  envelope[VERSION_OFFSET] = PROJECT_SYNC_ENVELOPE_VERSION;
  new DataView(
    envelope.buffer,
    envelope.byteOffset,
    envelope.byteLength,
  ).setBigUint64(KEY_EPOCH_OFFSET, BigInt(keyEpoch), false);
  envelope.set(nonce, NONCE_OFFSET);
  envelope.set(ciphertext, HEADER_BYTES);

  return envelope;
}

export function readWorkspaceSyncPayloadKeyEpoch(
  envelope: Uint8Array,
): number {
  assertEnvelopeHeader(envelope);

  const value = new DataView(
    envelope.buffer,
    envelope.byteOffset,
    envelope.byteLength,
  ).getBigUint64(KEY_EPOCH_OFFSET, false);

  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Workspace sync key epoch exceeds safe integer range");
  }

  const keyEpoch = Number(value);
  assertKeyEpoch(keyEpoch);
  return keyEpoch;
}

export async function decryptWorkspaceSyncPayload(
  workspaceId: WorkspaceId,
  workspaceKey: Uint8Array,
  envelope: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  assertWorkspaceKey(workspaceKey);

  const keyEpoch = readWorkspaceSyncPayloadKeyEpoch(envelope);
  const nonce = envelope.slice(NONCE_OFFSET, HEADER_BYTES);
  const ciphertext = envelope.slice(HEADER_BYTES);
  const aad = createAad(workspaceId, keyEpoch);

  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      aad,
      nonce,
      workspaceKey,
    );
  } catch {
    throw new Error("Could not authenticate encrypted Workspace sync payload");
  }
}

function assertEnvelopeHeader(envelope: Uint8Array): void {
  if (envelope.byteLength <= HEADER_BYTES) {
    throw new Error("Encrypted Workspace sync payload is too short");
  }

  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (envelope[index] !== MAGIC[index]) {
      throw new Error("Invalid encrypted Workspace sync payload magic");
    }
  }

  if (envelope[VERSION_OFFSET] !== PROJECT_SYNC_ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported Workspace sync envelope version: ${envelope[VERSION_OFFSET]}`,
    );
  }
}

function createAad(workspaceId: WorkspaceId, keyEpoch: number): Uint8Array {
  return new TextEncoder().encode(
    `${AAD_CONTEXT}\0${workspaceId}\0${keyEpoch}`,
  );
}

function assertWorkspaceKey(workspaceKey: Uint8Array): void {
  if (workspaceKey.byteLength !== PROJECT_KEY_BYTES) {
    throw new TypeError(
      `WorkspaceKey must be ${PROJECT_KEY_BYTES} bytes`,
    );
  }
}

function assertKeyEpoch(keyEpoch: number): void {
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) {
    throw new TypeError("Workspace key epoch must be a positive safe integer");
  }
}
