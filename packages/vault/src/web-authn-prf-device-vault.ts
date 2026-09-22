import {
  DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES,
  DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
  DEVICE_SIGNING_PRIVATE_KEY_BYTES,
  DEVICE_SIGNING_PUBLIC_KEY_BYTES,
  decryptDeviceVaultPayload,
  deriveDeviceVaultKey,
  destroyDeviceKeyMaterial,
  encryptDeviceVaultPayload,
  generateDeviceKeyMaterial,
  generateProjectKey,
  openSealedProjectKeyForDevice,
  PROJECT_KEY_BYTES,
  sealProjectKeyForDevice,
  signEd25519,
  type DeviceKeyMaterial,
} from "@floe-note/crypto";
import {
  parseDeviceId,
  parseProjectId,
  type DeviceId,
  type ProjectId,
} from "@floe-note/domain";
import type { DevicePublicIdentity } from "@floe-note/security";
import Dexie, { type Table } from "dexie";

const DATABASE_NAME = "floe-note-device-vault";
const VAULT_RECORD_ID = "device-v1";
const VAULT_RECORD_VERSION = 1 as const;
const VAULT_PAYLOAD_VERSION_V1 = 1 as const;
const VAULT_PAYLOAD_VERSION = 2 as const;
const PRF_INPUT_BYTES = 32;
const WEBAUTHN_TIMEOUT_MS = 60_000;

type VaultRecord = {
  id: typeof VAULT_RECORD_ID;
  version: typeof VAULT_RECORD_VERSION;
  credentialId: Uint8Array;
  prfInput: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

type SerializedDeviceKeyMaterialV1 = {
  version: typeof VAULT_PAYLOAD_VERSION_V1;
  deviceId: string;
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
  signingPublicKey: string;
  signingPrivateKey: string;
};

type SerializedProjectKey = {
  projectId: string;
  keyEpoch: number;
  projectKey: string;
};

type SerializedDeviceVaultPayload = {
  version: typeof VAULT_PAYLOAD_VERSION;
  deviceId: string;
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
  signingPublicKey: string;
  signingPrivateKey: string;
  projectKeys: SerializedProjectKey[];
};

type ProjectKeyEntry = {
  projectId: ProjectId;
  keyEpoch: number;
  projectKey: Uint8Array;
};

type DeviceVaultContents = {
  keyMaterial: DeviceKeyMaterial;
  projectKeys: ProjectKeyEntry[];
};

type PersistDeviceVault = (
  keyMaterial: DeviceKeyMaterial,
  projectKeys: readonly ProjectKeyEntry[],
) => Promise<void>;

type PrfOutput = {
  prf?: {
    enabled?: boolean;
    results?: {
      first?: ArrayBuffer;
    };
  };
};

class DeviceVaultDatabase extends Dexie {
  vault!: Table<VaultRecord, string>;

  constructor() {
    super(DATABASE_NAME);
    this.version(1).stores({
      vault: "&id",
    });
  }
}

export interface DeviceVault {
  hasVault(): Promise<boolean>;
  unlockOrCreate(): Promise<DeviceVaultSession>;
}

export class DeviceVaultSession {
  #keyMaterial: DeviceKeyMaterial | null;

  constructor(keyMaterial: DeviceKeyMaterial) {
    this.#keyMaterial = keyMaterial;
  }

  get publicIdentity(): DevicePublicIdentity {
    const keyMaterial = this.#requireOpen();
    return {
      deviceId: keyMaterial.publicIdentity.deviceId,
      encryptionPublicKey: keyMaterial.publicIdentity.encryptionPublicKey.slice(),
      signingPublicKey: keyMaterial.publicIdentity.signingPublicKey.slice(),
    };
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return signEd25519(message, this.#requireOpen().signingPrivateKey);
  }

  async close(): Promise<void> {
    if (!this.#keyMaterial) return;

    const keyMaterial = this.#keyMaterial;
    this.#keyMaterial = null;
    await destroyDeviceKeyMaterial(keyMaterial);
  }

  #requireOpen(): DeviceKeyMaterial {
    if (!this.#keyMaterial) {
      throw new Error("Device Vault session is closed");
    }
    return this.#keyMaterial;
  }
}

export class WebAuthnPrfDeviceVault implements DeviceVault {
  readonly #db = new DeviceVaultDatabase();

  async hasVault(): Promise<boolean> {
    return (await this.#db.vault.get(VAULT_RECORD_ID)) !== undefined;
  }

  async unlockOrCreate(): Promise<DeviceVaultSession> {
    assertWebAuthnAvailable();

    const record = await this.#db.vault.get(VAULT_RECORD_ID);
    return record ? this.#unlock(record) : this.#create();
  }

  async #create(): Promise<DeviceVaultSession> {
    const keyMaterial = await generateDeviceKeyMaterial();
    const prfInput = randomBytes(PRF_INPUT_BYTES);

    try {
      const credential = await createPrfCredential(prfInput);
      const createResult = readPrfOutput(credential);
      const prfOutput =
        createResult ??
        (await evaluatePrf(
          new Uint8Array(credential.rawId),
          prfInput,
        ));

      const vaultKey = await deriveDeviceVaultKey(prfOutput);
      const plaintext = serializeDeviceKeyMaterial(keyMaterial);

      try {
        const encrypted = await encryptDeviceVaultPayload(vaultKey, plaintext);

        await this.#db.vault.put({
          id: VAULT_RECORD_ID,
          version: VAULT_RECORD_VERSION,
          credentialId: new Uint8Array(credential.rawId),
          prfInput,
          nonce: encrypted.nonce,
          ciphertext: encrypted.ciphertext,
        });
      } finally {
        vaultKey.fill(0);
        plaintext.fill(0);
        prfOutput.fill(0);
      }

      return new DeviceVaultSession(keyMaterial);
    } catch (error) {
      await destroyDeviceKeyMaterial(keyMaterial);
      throw error;
    }
  }

  async #unlock(record: VaultRecord): Promise<DeviceVaultSession> {
    if (record.version !== VAULT_RECORD_VERSION) {
      throw new Error("Unsupported Device Vault version");
    }

    const prfOutput = await evaluatePrf(record.credentialId, record.prfInput);
    const vaultKey = await deriveDeviceVaultKey(prfOutput);

    try {
      const plaintext = await decryptDeviceVaultPayload(vaultKey, {
        nonce: record.nonce,
        ciphertext: record.ciphertext,
      });

      try {
        return new DeviceVaultSession(deserializeDeviceKeyMaterial(plaintext));
      } finally {
        plaintext.fill(0);
      }
    } catch {
      throw new Error("Could not decrypt Device Vault");
    } finally {
      vaultKey.fill(0);
      prfOutput.fill(0);
    }
  }
}

async function createPrfCredential(
  prfInput: Uint8Array,
): Promise<PublicKeyCredential> {
  const extensions = {
    prf: {
      eval: {
        first: toArrayBuffer(prfInput),
      },
    },
  } as unknown as AuthenticationExtensionsClientInputs;

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32).buffer,
      rp: {
        name: "Floe Note",
      },
      user: {
        id: randomBytes(32).buffer,
        name: "floe-note-device",
        displayName: "Floe Note Device",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -8 },
      ],
      timeout: WEBAUTHN_TIMEOUT_MS,
      authenticatorSelection: {
        residentKey: "discouraged",
        userVerification: "required",
      },
      attestation: "none",
      extensions,
    },
  });

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("WebAuthn credential creation failed");
  }

  return credential;
}

async function evaluatePrf(
  credentialId: Uint8Array,
  prfInput: Uint8Array,
): Promise<Uint8Array> {
  const credentialKey = bytesToBase64Url(credentialId);
  const extensions = {
    prf: {
      evalByCredential: {
        [credentialKey]: {
          first: toArrayBuffer(prfInput),
        },
      },
    },
  } as unknown as AuthenticationExtensionsClientInputs;

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32).buffer,
      allowCredentials: [
        {
          type: "public-key",
          id: toArrayBuffer(credentialId),
        },
      ],
      timeout: WEBAUTHN_TIMEOUT_MS,
      userVerification: "required",
      extensions,
    },
  });

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("WebAuthn authentication failed");
  }

  const output = readPrfOutput(credential);
  if (!output) {
    throw new Error("This authenticator does not provide WebAuthn PRF output");
  }
  return output;
}

function readPrfOutput(
  credential: PublicKeyCredential,
): Uint8Array | null {
  const results = credential.getClientExtensionResults() as
    AuthenticationExtensionsClientOutputs & PrfOutput;
  const first = results.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

function serializeDeviceKeyMaterial(
  keyMaterial: DeviceKeyMaterial,
): Uint8Array {
  const payload: SerializedDeviceKeyMaterial = {
    version: VAULT_PAYLOAD_VERSION,
    deviceId: keyMaterial.publicIdentity.deviceId,
    encryptionPublicKey: bytesToHex(
      keyMaterial.publicIdentity.encryptionPublicKey,
    ),
    encryptionPrivateKey: bytesToHex(keyMaterial.encryptionPrivateKey),
    signingPublicKey: bytesToHex(keyMaterial.publicIdentity.signingPublicKey),
    signingPrivateKey: bytesToHex(keyMaterial.signingPrivateKey),
  };

  return new TextEncoder().encode(JSON.stringify(payload));
}

function deserializeDeviceKeyMaterial(
  plaintext: Uint8Array,
): DeviceKeyMaterial {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Invalid Device Vault payload");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== VAULT_PAYLOAD_VERSION ||
    !("deviceId" in parsed) ||
    typeof parsed.deviceId !== "string" ||
    !("encryptionPublicKey" in parsed) ||
    typeof parsed.encryptionPublicKey !== "string" ||
    !("encryptionPrivateKey" in parsed) ||
    typeof parsed.encryptionPrivateKey !== "string" ||
    !("signingPublicKey" in parsed) ||
    typeof parsed.signingPublicKey !== "string" ||
    !("signingPrivateKey" in parsed) ||
    typeof parsed.signingPrivateKey !== "string"
  ) {
    throw new Error("Invalid Device Vault payload");
  }

  return {
    publicIdentity: {
      deviceId: parseDeviceId(parsed.deviceId),
      encryptionPublicKey: hexToBytes(
        parsed.encryptionPublicKey,
        DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
      ),
      signingPublicKey: hexToBytes(
        parsed.signingPublicKey,
        DEVICE_SIGNING_PUBLIC_KEY_BYTES,
      ),
    },
    encryptionPrivateKey: hexToBytes(
      parsed.encryptionPrivateKey,
      DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES,
    ),
    signingPrivateKey: hexToBytes(
      parsed.signingPrivateKey,
      DEVICE_SIGNING_PRIVATE_KEY_BYTES,
    ),
  };
}

function assertWebAuthnAvailable(): void {
  if (
    !globalThis.isSecureContext ||
    !("PublicKeyCredential" in globalThis) ||
    !navigator.credentials
  ) {
    throw new Error(
      "Device Vault requires WebAuthn in a secure browser context",
    );
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string, expectedBytes: number): Uint8Array {
  if (
    value.length !== expectedBytes * 2 ||
    !/^[0-9a-f]+$/i.test(value)
  ) {
    throw new Error("Invalid Device Vault key material");
  }

  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
