import type { DocumentId, ProjectId } from "@floe-note/domain";
import sodium from "libsodium-wrappers";

import { PROJECT_KEY_BYTES } from "./project-key.js";

export const PROJECT_STORAGE_ENVELOPE_VERSION = 1 as const;

export type ProjectStorageRecordContext =
  | {
      kind: "manifest";
    }
  | {
      kind: "document";
      documentId: DocumentId;
    };

const MAGIC = Uint8Array.of(0x46, 0x4c, 0x53, 0x54); // "FLST"
const VERSION_OFFSET = MAGIC.byteLength;
const KEY_EPOCH_OFFSET = VERSION_OFFSET + 1;
const KEY_EPOCH_BYTES = 8;
const NONCE_OFFSET = KEY_EPOCH_OFFSET + KEY_EPOCH_BYTES;
const NONCE_BYTES = 24;
const HEADER_BYTES = NONCE_OFFSET + NONCE_BYTES;
const AAD_CONTEXT = "floe-note/project-storage/v1";

export async function encryptProjectStoragePayload(
  projectId: ProjectId,
  keyEpoch: number,
  context: ProjectStorageRecordContext,
  projectKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  assertProjectKey(projectKey);
  assertKeyEpoch(keyEpoch);

  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const aad = createAad(projectId, keyEpoch, context);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    projectKey,
  );

  const envelope = new Uint8Array(HEADER_BYTES + ciphertext.byteLength);
  envelope.set(MAGIC, 0);
  envelope[VERSION_OFFSET] = PROJECT_STORAGE_ENVELOPE_VERSION;
  new DataView(
    envelope.buffer,
    envelope.byteOffset,
    envelope.byteLength,
  ).setBigUint64(KEY_EPOCH_OFFSET, BigInt(keyEpoch), false);
  envelope.set(nonce, NONCE_OFFSET);
  envelope.set(ciphertext, HEADER_BYTES);

  return envelope;
}

export function readProjectStoragePayloadKeyEpoch(
  envelope: Uint8Array,
): number {
  assertEnvelopeHeader(envelope);

  const value = new DataView(
    envelope.buffer,
    envelope.byteOffset,
    envelope.byteLength,
  ).getBigUint64(KEY_EPOCH_OFFSET, false);

  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Project storage key epoch exceeds safe integer range");
  }

  const keyEpoch = Number(value);
  assertKeyEpoch(keyEpoch);
  return keyEpoch;
}

export async function decryptProjectStoragePayload(
  projectId: ProjectId,
  expectedKeyEpoch: number,
  context: ProjectStorageRecordContext,
  projectKey: Uint8Array,
  envelope: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  assertProjectKey(projectKey);
  assertKeyEpoch(expectedKeyEpoch);

  const keyEpoch = readProjectStoragePayloadKeyEpoch(envelope);
  if (keyEpoch !== expectedKeyEpoch) {
    throw new Error(
      `Encrypted Project storage uses key epoch ${keyEpoch}, expected ${expectedKeyEpoch}`,
    );
  }

  const nonce = envelope.slice(NONCE_OFFSET, HEADER_BYTES);
  const ciphertext = envelope.slice(HEADER_BYTES);
  const aad = createAad(projectId, keyEpoch, context);

  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      aad,
      nonce,
      projectKey,
    );
  } catch {
    throw new Error("Could not authenticate encrypted Project storage payload");
  }
}

function assertEnvelopeHeader(envelope: Uint8Array): void {
  if (envelope.byteLength <= HEADER_BYTES) {
    throw new Error("Encrypted Project storage payload is too short");
  }

  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (envelope[index] !== MAGIC[index]) {
      throw new Error("Invalid encrypted Project storage payload magic");
    }
  }

  if (envelope[VERSION_OFFSET] !== PROJECT_STORAGE_ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported Project storage envelope version: ${envelope[VERSION_OFFSET]}`,
    );
  }
}

function createAad(
  projectId: ProjectId,
  keyEpoch: number,
  context: ProjectStorageRecordContext,
): Uint8Array {
  const recordId =
    context.kind === "document" ? context.documentId : "";

  return new TextEncoder().encode(
    `${AAD_CONTEXT}\0${projectId}\0${keyEpoch}\0${context.kind}\0${recordId}`,
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
