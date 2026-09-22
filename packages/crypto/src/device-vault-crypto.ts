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
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(prfOutput),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new ArrayBuffer(32),
      info: toArrayBuffer(new TextEncoder().encode(DEVICE_VAULT_KDF_CONTEXT)),
    },
    keyMaterial,
    DEVICE_VAULT_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
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

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function assertVaultKey(vaultKey: Uint8Array): void {
  if (vaultKey.byteLength !== DEVICE_VAULT_KEY_BYTES) {
    throw new TypeError(
      `Device Vault key must be ${DEVICE_VAULT_KEY_BYTES} bytes`,
    );
  }
}
