import sodium from "libsodium-wrappers";

export const DEVICE_VAULT_KEY_BYTES = 32;

const DEVICE_VAULT_KDF_CONTEXT = "floe-note/device-vault/v1";
const DEVICE_VAULT_AAD = "floe-note-device-vault-v1";

export type EncryptedDeviceVaultPayload = {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

export async function deriveDeviceVaultKey(
  prfOutput: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;

  const prk = sodium.crypto_kdf_hkdf_sha256_extract(null, prfOutput);
  try {
    return sodium.crypto_kdf_hkdf_sha256_expand(
      DEVICE_VAULT_KEY_BYTES,
      DEVICE_VAULT_KDF_CONTEXT,
      prk,
    );
  } finally {
    sodium.memzero(prk);
  }
}

export async function encryptDeviceVaultPayload(
  vaultKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<EncryptedDeviceVaultPayload> {
  await sodium.ready;
  assertVaultKey(vaultKey);

  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    DEVICE_VAULT_AAD,
    null,
    nonce,
    vaultKey,
  );

  return { nonce, ciphertext };
}

export async function decryptDeviceVaultPayload(
  vaultKey: Uint8Array,
  encrypted: EncryptedDeviceVaultPayload,
): Promise<Uint8Array> {
  await sodium.ready;
  assertVaultKey(vaultKey);

  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    encrypted.ciphertext,
    DEVICE_VAULT_AAD,
    encrypted.nonce,
    vaultKey,
  );
}

function assertVaultKey(vaultKey: Uint8Array): void {
  if (vaultKey.byteLength !== DEVICE_VAULT_KEY_BYTES) {
    throw new TypeError(
      `Device Vault key must be ${DEVICE_VAULT_KEY_BYTES} bytes`,
    );
  }
}
