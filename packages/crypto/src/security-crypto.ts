import sodium from "libsodium-wrappers";

export const SHA256_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;

export async function signEd25519(
  message: Uint8Array,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;

  const signature = sodium.crypto_sign_detached(message, privateKey);
  if (signature.byteLength !== ED25519_SIGNATURE_BYTES) {
    throw new Error("Unexpected Ed25519 signature length");
  }
  return signature;
}

export async function verifyEd25519Signature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  await sodium.ready;

  if (signature.byteLength !== ED25519_SIGNATURE_BYTES) {
    return false;
  }

  return sodium.crypto_sign_verify_detached(signature, message, publicKey);
}

export async function sha256(message: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;

  const digest = sodium.crypto_hash_sha256(message);
  if (digest.byteLength !== SHA256_BYTES) {
    throw new Error("Unexpected SHA-256 digest length");
  }
  return digest;
}
