import type { ProjectId } from "@floe-note/domain";
import sodium from "libsodium-wrappers";

import { PROJECT_KEY_BYTES } from "./project-key.js";

export const PROJECT_SYNC_ENVELOPE_VERSION = 1 as const;

const MAGIC = Uint8Array.of(0x46, 0x4c, 0x4f, 0x45); // "FLOE"
const VERSION_OFFSET = MAGIC.byteLength;
const KEY_EPOCH_OFFSET = VERSION_OFFSET + 1;
const KEY_EPOCH_BYTES = 8;
const NONCE_OFFSET = KEY_EPOCH_OFFSET + KEY_EPOCH_BYTES;
const NONCE_BYTES = 24;
const HEADER_BYTES = NONCE_OFFSET + NONCE_BYTES;
const AAD_CONTEXT = "floe-note/project-sync/v1";

export async function encryptProjectSyncPayload(
  projectId: ProjectId,
  keyEpoch: number,
  projectKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  assertProjectKey(projectKey);
  assertKeyEpoch(keyEpoch);

  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const aad = createAad(projectId, keyEpoch);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    projectKey,
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

export function readProjectSyncPayloadKeyEpoch(
  envelope: Uint8Array,
): number {
  assertEnvelopeHeader(envelope);

  const value = new DataView(
    envelope.buffer,
    envelope.byteOffset,
    envelope.byteLength,
  ).getBigUint64(KEY_EPOCH_OFFSET, false);

  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Project sync key epoch exceeds safe integer range");
  }

  const keyEpoch = Number(value);
  assertKeyEpoch(keyEpoch);
  return keyEpoch;
}

export async function decryptProjectSyncPayload(
  projectId: ProjectId,
  projectKey: Uint8Array,
  envelope: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  assertProjectKey(projectKey);

  const keyEpoch = readProjectSyncPayloadKeyEpoch(envelope);
  const nonce = envelope.slice(NONCE_OFFSET, HEADER_BYTES);
  const ciphertext = envelope.slice(HEADER_BYTES);
  const aad = createAad(projectId, keyEpoch);

  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      aad,
      nonce,
      projectKey,
    );
  } catch {
    throw new Error("Could not authenticate encrypted Project sync payload");
  }
}

function assertEnvelopeHeader(envelope: Uint8Array): void {
  if (envelope.byteLength <= HEADER_BYTES) {
    throw new Error("Encrypted Project sync payload is too short");
  }

  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (envelope[index] !== MAGIC[index]) {
      throw new Error("Invalid encrypted Project sync payload magic");
    }
  }

  if (envelope[VERSION_OFFSET] !== PROJECT_SYNC_ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported Project sync envelope version: ${envelope[VERSION_OFFSET]}`,
    );
  }
}

function createAad(projectId: ProjectId, keyEpoch: number): Uint8Array {
  return new TextEncoder().encode(
    `${AAD_CONTEXT}\0${projectId}\0${keyEpoch}`,
  );
}

function assertProjectKey(projectKey: Uint8Array): void {
  if (projectKey.byteLength !== PROJECT_KEY_BYTES) {
    throw new TypeError(
      `ProjectKey must be ${PROJECT_KEY_BYTES} bytes`,
    );
  }
}

function assertKeyEpoch(keyEpoch: number): void {
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) {
    throw new TypeError("Project key epoch must be a positive safe integer");
  }
}
