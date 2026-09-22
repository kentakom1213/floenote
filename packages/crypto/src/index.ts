export {
  DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES,
  DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
  DEVICE_SIGNING_PRIVATE_KEY_BYTES,
  DEVICE_SIGNING_PUBLIC_KEY_BYTES,
  destroyDeviceKeyMaterial,
  generateDeviceKeyMaterial,
} from "./device-keys.js";

export type { DeviceKeyMaterial } from "./device-keys.js";

export {
  decryptDeviceVaultPayload,
  deriveDeviceVaultKey,
  encryptDeviceVaultPayload,
  DEVICE_VAULT_KEY_BYTES,
} from "./device-vault-crypto.js";

export type { EncryptedDeviceVaultPayload } from "./device-vault-crypto.js";

export {
  ED25519_SIGNATURE_BYTES,
  SHA256_BYTES,
  sha256,
  signEd25519,
  verifyEd25519Signature,
} from "./security-crypto.js";
