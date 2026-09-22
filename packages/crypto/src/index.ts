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

export {
  PROJECT_KEY_BYTES,
  PROJECT_KEY_ENVELOPE_VERSION,
  generateProjectKey,
  openSealedProjectKeyForDevice,
  sealProjectKeyForDevice,
} from "./project-key.js";

export type { ProjectKeyEnvelopeContext } from "./project-key.js";

export {
  decryptProjectSyncPayload,
  encryptProjectSyncPayload,
  PROJECT_SYNC_ENVELOPE_VERSION,
  readProjectSyncPayloadKeyEpoch,
} from "./project-sync-crypto.js";

export {
  decryptProjectStoragePayload,
  encryptProjectStoragePayload,
  PROJECT_STORAGE_ENVELOPE_VERSION,
  readProjectStoragePayloadKeyEpoch,
} from "./project-storage-crypto.js";

export type { ProjectStorageRecordContext } from "./project-storage-crypto.js";
