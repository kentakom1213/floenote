import {
  DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES,
  DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
  DEVICE_SIGNING_PRIVATE_KEY_BYTES,
  DEVICE_SIGNING_PUBLIC_KEY_BYTES,
  decryptDeviceVaultPayload,
  decryptProjectStoragePayload as decryptProjectStoragePayloadWithKey,
  decryptProjectSyncPayload as decryptProjectSyncPayloadWithKey,
  deriveDeviceVaultKey,
  destroyDeviceKeyMaterial,
  encryptDeviceVaultPayload,
  encryptProjectStoragePayload as encryptProjectStoragePayloadWithKey,
  encryptProjectSyncPayload as encryptProjectSyncPayloadWithKey,
  generateDeviceKeyMaterial,
  generateProjectKey,
  openSealedProjectKeyForDevice,
  PROJECT_KEY_BYTES,
  readProjectStoragePayloadKeyEpoch,
  readProjectSyncPayloadKeyEpoch,
  sealProjectKeyForDevice,
  signEd25519,
  type DeviceKeyMaterial,
  type ProjectStorageRecordContext,
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
  #projectKeys: ProjectKeyEntry[];
  #vaultKey: Uint8Array | null;
  readonly #persist: PersistDeviceVault;

  constructor(
    contents: DeviceVaultContents,
    vaultKey: Uint8Array,
    persist: PersistDeviceVault,
  ) {
    this.#keyMaterial = contents.keyMaterial;
    this.#projectKeys = contents.projectKeys;
    this.#vaultKey = vaultKey;
    this.#persist = persist;
  }

  get publicIdentity(): DevicePublicIdentity {
    const keyMaterial = this.#requireOpen();
    return {
      deviceId: keyMaterial.publicIdentity.deviceId,
      encryptionPublicKey: keyMaterial.publicIdentity.encryptionPublicKey.slice(),
      signingPublicKey: keyMaterial.publicIdentity.signingPublicKey.slice(),
    };
  }

  hasProjectKey(projectId: ProjectId, keyEpoch: number): boolean {
    this.#requireOpen();
    return this.#projectKeys.some(
      (entry) =>
        entry.projectId === projectId &&
        entry.keyEpoch === keyEpoch,
    );
  }

  async encryptProjectSyncPayload(
    projectId: ProjectId,
    keyEpoch: number,
    plaintext: Uint8Array,
  ): Promise<Uint8Array> {
    this.#requireOpen();
    const entry = this.#findProjectKey(projectId, keyEpoch);
    if (!entry) {
      throw new Error(
        `ProjectKey epoch ${keyEpoch} is not available on this device`,
      );
    }

    return encryptProjectSyncPayloadWithKey(
      projectId,
      keyEpoch,
      entry.projectKey,
      plaintext,
    );
  }

  async decryptProjectSyncPayload(
    projectId: ProjectId,
    expectedKeyEpoch: number,
    envelope: Uint8Array,
  ): Promise<Uint8Array> {
    this.#requireOpen();
    assertKeyEpoch(expectedKeyEpoch);

    const envelopeKeyEpoch = readProjectSyncPayloadKeyEpoch(envelope);
    if (envelopeKeyEpoch !== expectedKeyEpoch) {
      throw new Error(
        `Encrypted sync uses key epoch ${envelopeKeyEpoch}, expected ${expectedKeyEpoch}`,
      );
    }

    const entry = this.#findProjectKey(projectId, expectedKeyEpoch);
    if (!entry) {
      throw new Error(
        `ProjectKey epoch ${expectedKeyEpoch} is not available on this device`,
      );
    }

    return decryptProjectSyncPayloadWithKey(
      projectId,
      entry.projectKey,
      envelope,
    );
  }

  async encryptProjectStoragePayload(
    projectId: ProjectId,
    keyEpoch: number,
    context: ProjectStorageRecordContext,
    plaintext: Uint8Array,
  ): Promise<Uint8Array> {
    this.#requireOpen();
    const entry = this.#findProjectKey(projectId, keyEpoch);
    if (!entry) {
      throw new Error(
        `ProjectKey epoch ${keyEpoch} is not available on this device`,
      );
    }

    return encryptProjectStoragePayloadWithKey(
      projectId,
      keyEpoch,
      context,
      entry.projectKey,
      plaintext,
    );
  }

  async decryptProjectStoragePayload(
    projectId: ProjectId,
    context: ProjectStorageRecordContext,
    envelope: Uint8Array,
  ): Promise<{ keyEpoch: number; plaintext: Uint8Array }> {
    this.#requireOpen();
    const keyEpoch = readProjectStoragePayloadKeyEpoch(envelope);
    const entry = this.#findProjectKey(projectId, keyEpoch);
    if (!entry) {
      throw new Error(
        `ProjectKey epoch ${keyEpoch} is not available on this device`,
      );
    }

    return {
      keyEpoch,
      plaintext: await decryptProjectStoragePayloadWithKey(
        projectId,
        keyEpoch,
        context,
        entry.projectKey,
        envelope,
      ),
    };
  }

  async createProjectKeyIfMissing(
    projectId: ProjectId,
    keyEpoch: number,
  ): Promise<boolean> {
    this.#requireOpen();
    assertKeyEpoch(keyEpoch);

    if (this.hasProjectKey(projectId, keyEpoch)) {
      return false;
    }

    const projectKey = await generateProjectKey();
    this.#projectKeys.push({
      projectId,
      keyEpoch,
      projectKey,
    });
    sortProjectKeys(this.#projectKeys);

    try {
      await this.#persistCurrentState();
      return true;
    } catch (error) {
      this.#projectKeys = this.#projectKeys.filter(
        (entry) => entry.projectKey !== projectKey,
      );
      projectKey.fill(0);
      throw error;
    }
  }

  async sealProjectKeyForRecipient(
    projectId: ProjectId,
    keyEpoch: number,
    recipientDeviceId: DeviceId,
    recipientEncryptionPublicKey: Uint8Array,
    securityHead: Uint8Array,
  ): Promise<Uint8Array> {
    this.#requireOpen();
    const entry = this.#findProjectKey(projectId, keyEpoch);
    if (!entry) {
      throw new Error(
        `ProjectKey epoch ${keyEpoch} is not available on this device`,
      );
    }

    return sealProjectKeyForDevice(
      {
        projectId,
        keyEpoch,
        recipientDeviceId,
        securityHead,
      },
      entry.projectKey,
      recipientEncryptionPublicKey,
    );
  }

  async storeSealedProjectKey(
    sealedEnvelope: Uint8Array,
    projectId: ProjectId,
    keyEpoch: number,
    securityHead: Uint8Array,
  ): Promise<void> {
    const keyMaterial = this.#requireOpen();
    const recipientDeviceId = keyMaterial.publicIdentity.deviceId;
    const projectKey = await openSealedProjectKeyForDevice(
      sealedEnvelope,
      {
        projectId,
        keyEpoch,
        recipientDeviceId,
        securityHead,
      },
      keyMaterial.publicIdentity.encryptionPublicKey,
      keyMaterial.encryptionPrivateKey,
    );

    const existing = this.#findProjectKey(projectId, keyEpoch);
    if (existing) {
      const matches = bytesEqual(existing.projectKey, projectKey);
      projectKey.fill(0);
      if (!matches) {
        throw new Error(
          "A different ProjectKey already exists for this epoch",
        );
      }
      return;
    }

    const entry: ProjectKeyEntry = {
      projectId,
      keyEpoch,
      projectKey,
    };
    this.#projectKeys.push(entry);
    sortProjectKeys(this.#projectKeys);

    try {
      await this.#persistCurrentState();
    } catch (error) {
      this.#projectKeys = this.#projectKeys.filter(
        (candidate) => candidate !== entry,
      );
      projectKey.fill(0);
      throw error;
    }
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return signEd25519(message, this.#requireOpen().signingPrivateKey);
  }

  async close(): Promise<void> {
    if (!this.#keyMaterial) return;

    const keyMaterial = this.#keyMaterial;
    this.#keyMaterial = null;

    for (const entry of this.#projectKeys) {
      entry.projectKey.fill(0);
    }
    this.#projectKeys = [];

    if (this.#vaultKey) {
      this.#vaultKey.fill(0);
      this.#vaultKey = null;
    }

    await destroyDeviceKeyMaterial(keyMaterial);
  }

  async #persistCurrentState(): Promise<void> {
    const keyMaterial = this.#requireOpen();
    if (!this.#vaultKey) {
      throw new Error("Device Vault session is closed");
    }
    await this.#persist(keyMaterial, this.#projectKeys);
  }

  #findProjectKey(
    projectId: ProjectId,
    keyEpoch: number,
  ): ProjectKeyEntry | undefined {
    return this.#projectKeys.find(
      (entry) =>
        entry.projectId === projectId &&
        entry.keyEpoch === keyEpoch,
    );
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
    let vaultKey: Uint8Array | null = null;

    try {
      const credential = await createPrfCredential(prfInput);
      const createResult = readPrfOutput(credential);
      const prfOutput =
        createResult ??
        (await evaluatePrf(
          new Uint8Array(credential.rawId),
          prfInput,
        ));

      try {
        vaultKey = await deriveDeviceVaultKey(prfOutput);
      } finally {
        prfOutput.fill(0);
      }

      const recordBase = {
        id: VAULT_RECORD_ID,
        version: VAULT_RECORD_VERSION,
        credentialId: new Uint8Array(credential.rawId),
        prfInput,
      } as const;
      const projectKeys: ProjectKeyEntry[] = [];

      await this.#persistVault(
        recordBase,
        vaultKey,
        keyMaterial,
        projectKeys,
      );

      return new DeviceVaultSession(
        { keyMaterial, projectKeys },
        vaultKey,
        (nextKeyMaterial, nextProjectKeys) =>
          this.#persistVault(
            recordBase,
            vaultKey as Uint8Array,
            nextKeyMaterial,
            nextProjectKeys,
          ),
      );
    } catch (error) {
      if (vaultKey) vaultKey.fill(0);
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
    prfOutput.fill(0);

    try {
      const plaintext = await decryptDeviceVaultPayload(vaultKey, {
        nonce: record.nonce,
        ciphertext: record.ciphertext,
      });

      let contents: DeviceVaultContents;
      try {
        contents = deserializeDeviceVaultPayload(plaintext);
      } finally {
        plaintext.fill(0);
      }

      const recordBase = {
        id: record.id,
        version: record.version,
        credentialId: record.credentialId,
        prfInput: record.prfInput,
      } as const;

      return new DeviceVaultSession(
        contents,
        vaultKey,
        (keyMaterial, projectKeys) =>
          this.#persistVault(
            recordBase,
            vaultKey,
            keyMaterial,
            projectKeys,
          ),
      );
    } catch (error) {
      vaultKey.fill(0);
      throw error instanceof Error
        ? error
        : new Error("Could not decrypt Device Vault");
    }
  }

  async #persistVault(
    recordBase: Pick<
      VaultRecord,
      "id" | "version" | "credentialId" | "prfInput"
    >,
    vaultKey: Uint8Array,
    keyMaterial: DeviceKeyMaterial,
    projectKeys: readonly ProjectKeyEntry[],
  ): Promise<void> {
    const plaintext = serializeDeviceVaultPayload(keyMaterial, projectKeys);
    try {
      const encrypted = await encryptDeviceVaultPayload(vaultKey, plaintext);
      await this.#db.vault.put({
        ...recordBase,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
      });
    } finally {
      plaintext.fill(0);
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

function serializeDeviceVaultPayload(
  keyMaterial: DeviceKeyMaterial,
  projectKeys: readonly ProjectKeyEntry[],
): Uint8Array {
  const payload: SerializedDeviceVaultPayload = {
    version: VAULT_PAYLOAD_VERSION,
    deviceId: keyMaterial.publicIdentity.deviceId,
    encryptionPublicKey: bytesToHex(
      keyMaterial.publicIdentity.encryptionPublicKey,
    ),
    encryptionPrivateKey: bytesToHex(keyMaterial.encryptionPrivateKey),
    signingPublicKey: bytesToHex(keyMaterial.publicIdentity.signingPublicKey),
    signingPrivateKey: bytesToHex(keyMaterial.signingPrivateKey),
    projectKeys: projectKeys.map((entry) => ({
      projectId: entry.projectId,
      keyEpoch: entry.keyEpoch,
      projectKey: bytesToHex(entry.projectKey),
    })),
  };

  return new TextEncoder().encode(JSON.stringify(payload));
}

function deserializeDeviceVaultPayload(
  plaintext: Uint8Array,
): DeviceVaultContents {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Invalid Device Vault payload");
  }

  if (!isBaseVaultPayload(parsed)) {
    throw new Error("Invalid Device Vault payload");
  }

  const keyMaterial: DeviceKeyMaterial = {
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

  if (parsed.version === VAULT_PAYLOAD_VERSION_V1) {
    return {
      keyMaterial,
      projectKeys: [],
    };
  }

  if (
    parsed.version !== VAULT_PAYLOAD_VERSION ||
    !("projectKeys" in parsed) ||
    !Array.isArray(parsed.projectKeys)
  ) {
    throw new Error("Unsupported Device Vault payload version");
  }

  const projectKeys = parsed.projectKeys.map(parseProjectKeyEntry);
  const seen = new Set<string>();
  for (const entry of projectKeys) {
    const identity = `${entry.projectId}:${entry.keyEpoch}`;
    if (seen.has(identity)) {
      throw new Error("Duplicate ProjectKey entry in Device Vault");
    }
    seen.add(identity);
  }
  sortProjectKeys(projectKeys);

  return {
    keyMaterial,
    projectKeys,
  };
}

function isBaseVaultPayload(
  parsed: unknown,
): parsed is SerializedDeviceKeyMaterialV1 | SerializedDeviceVaultPayload {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    (parsed.version === VAULT_PAYLOAD_VERSION_V1 ||
      parsed.version === VAULT_PAYLOAD_VERSION) &&
    "deviceId" in parsed &&
    typeof parsed.deviceId === "string" &&
    "encryptionPublicKey" in parsed &&
    typeof parsed.encryptionPublicKey === "string" &&
    "encryptionPrivateKey" in parsed &&
    typeof parsed.encryptionPrivateKey === "string" &&
    "signingPublicKey" in parsed &&
    typeof parsed.signingPublicKey === "string" &&
    "signingPrivateKey" in parsed &&
    typeof parsed.signingPrivateKey === "string"
  );
}

function parseProjectKeyEntry(value: unknown): ProjectKeyEntry {
  if (
    typeof value !== "object" ||
    value === null ||
    !("projectId" in value) ||
    typeof value.projectId !== "string" ||
    !("keyEpoch" in value) ||
    typeof value.keyEpoch !== "number" ||
    !Number.isSafeInteger(value.keyEpoch) ||
    value.keyEpoch < 1 ||
    !("projectKey" in value) ||
    typeof value.projectKey !== "string"
  ) {
    throw new Error("Invalid ProjectKey entry in Device Vault");
  }

  return {
    projectId: parseProjectId(value.projectId),
    keyEpoch: value.keyEpoch,
    projectKey: hexToBytes(value.projectKey, PROJECT_KEY_BYTES),
  };
}

function sortProjectKeys(projectKeys: ProjectKeyEntry[]): void {
  projectKeys.sort((left, right) => {
    const projectOrder = left.projectId.localeCompare(right.projectId);
    return projectOrder !== 0
      ? projectOrder
      : left.keyEpoch - right.keyEpoch;
  });
}

function assertKeyEpoch(keyEpoch: number): void {
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) {
    throw new TypeError("ProjectKey epoch must be a positive safe integer");
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
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
