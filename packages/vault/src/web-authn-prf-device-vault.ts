import {
  DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES,
  DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
  DEVICE_SIGNING_PRIVATE_KEY_BYTES,
  DEVICE_SIGNING_PUBLIC_KEY_BYTES,
  decryptDeviceVaultPayload,
  decryptWorkspaceStoragePayload as decryptWorkspaceStoragePayloadWithKey,
  decryptWorkspaceSyncPayload as decryptWorkspaceSyncPayloadWithKey,
  deriveDeviceVaultKey,
  destroyDeviceKeyMaterial,
  encryptDeviceVaultPayload,
  encryptWorkspaceStoragePayload as encryptWorkspaceStoragePayloadWithKey,
  encryptWorkspaceSyncPayload as encryptWorkspaceSyncPayloadWithKey,
  generateDeviceKeyMaterial,
  generateWorkspaceKey,
  openSealedWorkspaceKeyForDevice,
  PROJECT_KEY_BYTES,
  readWorkspaceStoragePayloadKeyEpoch,
  readWorkspaceSyncPayloadKeyEpoch,
  sealWorkspaceKeyForDevice,
  signEd25519,
  type DeviceKeyMaterial,
  type WorkspaceStorageRecordContext,
} from "@floe-note/crypto";
import {
  parseDeviceId,
  parseWorkspaceId,
  type DeviceId,
  type WorkspaceId,
} from "@floe-note/domain";
import type { DevicePublicIdentity } from "@floe-note/security";
import Dexie, { type Table } from "dexie";

const DATABASE_NAME = "floe-note-device-vault";
const VAULT_RECORD_ID = "workspace-device-v1";
const VAULT_RECORD_VERSION = 1 as const;
const VAULT_PAYLOAD_VERSION = 4 as const;
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

type SerializedWorkspaceKey = {
  workspaceId: string;
  keyEpoch: number;
  workspaceKey: string;
};

type SerializedDeviceVaultPayload = {
  version: typeof VAULT_PAYLOAD_VERSION;
  deviceId: string;
  displayName: string;
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
  signingPublicKey: string;
  signingPrivateKey: string;
  workspaceKeys: SerializedWorkspaceKey[];
};

type WorkspaceKeyEntry = {
  workspaceId: WorkspaceId;
  keyEpoch: number;
  workspaceKey: Uint8Array;
};

type DeviceVaultContents = {
  keyMaterial: DeviceKeyMaterial;
  displayName: string;
  workspaceKeys: WorkspaceKeyEntry[];
};

type PersistDeviceVault = (
  keyMaterial: DeviceKeyMaterial,
  displayName: string,
  workspaceKeys: readonly WorkspaceKeyEntry[],
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
  unlock(): Promise<DeviceVaultSession>;
  createWithExistingPasskey(displayName: string): Promise<DeviceVaultSession>;
  createWithNewPasskey(displayName: string): Promise<DeviceVaultSession>;
  unlockOrCreate(displayName?: string): Promise<DeviceVaultSession>;
  eraseVault(): Promise<void>;
}

export class DeviceVaultSession {
  #keyMaterial: DeviceKeyMaterial | null;
  #displayName: string;
  #workspaceKeys: WorkspaceKeyEntry[];
  #vaultKey: Uint8Array | null;
  readonly #persist: PersistDeviceVault;

  constructor(
    contents: DeviceVaultContents,
    vaultKey: Uint8Array,
    persist: PersistDeviceVault,
  ) {
    this.#keyMaterial = contents.keyMaterial;
    this.#displayName = contents.displayName;
    this.#workspaceKeys = contents.workspaceKeys;
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

  get displayName(): string {
    this.#requireOpen();
    return this.#displayName;
  }

  async renameDevice(displayName: string): Promise<void> {
    this.#requireOpen();
    const normalized = normalizeDeviceDisplayName(displayName);
    if (normalized === this.#displayName) return;

    await this.#persist(this.#requireOpen(), normalized, this.#workspaceKeys);
    this.#displayName = normalized;
  }

  hasWorkspaceKey(workspaceId: WorkspaceId, keyEpoch: number): boolean {
    this.#requireOpen();
    return this.#workspaceKeys.some(
      (entry) =>
        entry.workspaceId === workspaceId &&
        entry.keyEpoch === keyEpoch,
    );
  }

  async encryptWorkspaceSyncPayload(
    workspaceId: WorkspaceId,
    keyEpoch: number,
    plaintext: Uint8Array,
  ): Promise<Uint8Array> {
    this.#requireOpen();
    const entry = this.#findWorkspaceKey(workspaceId, keyEpoch);
    if (!entry) {
      throw new Error(
        `WorkspaceKey epoch ${keyEpoch} is not available on this device`,
      );
    }

    return encryptWorkspaceSyncPayloadWithKey(
      workspaceId,
      keyEpoch,
      entry.workspaceKey,
      plaintext,
    );
  }

  async decryptWorkspaceSyncPayload(
    workspaceId: WorkspaceId,
    expectedKeyEpoch: number,
    envelope: Uint8Array,
  ): Promise<Uint8Array> {
    this.#requireOpen();
    assertKeyEpoch(expectedKeyEpoch);

    const envelopeKeyEpoch = readWorkspaceSyncPayloadKeyEpoch(envelope);
    if (envelopeKeyEpoch !== expectedKeyEpoch) {
      throw new Error(
        `Encrypted sync uses key epoch ${envelopeKeyEpoch}, expected ${expectedKeyEpoch}`,
      );
    }

    const entry = this.#findWorkspaceKey(workspaceId, expectedKeyEpoch);
    if (!entry) {
      throw new Error(
        `WorkspaceKey epoch ${expectedKeyEpoch} is not available on this device`,
      );
    }

    return decryptWorkspaceSyncPayloadWithKey(
      workspaceId,
      entry.workspaceKey,
      envelope,
    );
  }

  async encryptWorkspaceStoragePayload(
    workspaceId: WorkspaceId,
    keyEpoch: number,
    context: WorkspaceStorageRecordContext,
    plaintext: Uint8Array,
  ): Promise<Uint8Array> {
    this.#requireOpen();
    const entry = this.#findWorkspaceKey(workspaceId, keyEpoch);
    if (!entry) {
      throw new Error(
        `WorkspaceKey epoch ${keyEpoch} is not available on this device`,
      );
    }

    return encryptWorkspaceStoragePayloadWithKey(
      workspaceId,
      keyEpoch,
      context,
      entry.workspaceKey,
      plaintext,
    );
  }

  async decryptWorkspaceStoragePayload(
    workspaceId: WorkspaceId,
    context: WorkspaceStorageRecordContext,
    envelope: Uint8Array,
  ): Promise<{ keyEpoch: number; plaintext: Uint8Array }> {
    this.#requireOpen();
    const keyEpoch = readWorkspaceStoragePayloadKeyEpoch(envelope);
    const entry = this.#findWorkspaceKey(workspaceId, keyEpoch);
    if (!entry) {
      throw new Error(
        `WorkspaceKey epoch ${keyEpoch} is not available on this device`,
      );
    }

    return {
      keyEpoch,
      plaintext: await decryptWorkspaceStoragePayloadWithKey(
        workspaceId,
        keyEpoch,
        context,
        entry.workspaceKey,
        envelope,
      ),
    };
  }

  async createWorkspaceKeyIfMissing(
    workspaceId: WorkspaceId,
    keyEpoch: number,
  ): Promise<boolean> {
    this.#requireOpen();
    assertKeyEpoch(keyEpoch);

    if (this.hasWorkspaceKey(workspaceId, keyEpoch)) {
      return false;
    }

    const workspaceKey = await generateWorkspaceKey();
    this.#workspaceKeys.push({
      workspaceId,
      keyEpoch,
      workspaceKey,
    });
    sortWorkspaceKeys(this.#workspaceKeys);

    try {
      await this.#persistCurrentState();
      return true;
    } catch (error) {
      this.#workspaceKeys = this.#workspaceKeys.filter(
        (entry) => entry.workspaceKey !== workspaceKey,
      );
      workspaceKey.fill(0);
      throw error;
    }
  }

  async prepareWorkspaceKeyRotation(
    workspaceId: WorkspaceId,
    keyEpoch: number,
    securityHead: Uint8Array,
    recipients: readonly DevicePublicIdentity[],
  ): Promise<readonly {
    recipientDeviceId: DeviceId;
    sealedEnvelope: Uint8Array;
  }[]> {
    this.#requireOpen();
    assertKeyEpoch(keyEpoch);

    if (this.#findWorkspaceKey(workspaceId, keyEpoch)) {
      throw new Error(
        `WorkspaceKey epoch ${keyEpoch} already exists on this device`,
      );
    }

    const seen = new Set<DeviceId>();
    for (const recipient of recipients) {
      if (seen.has(recipient.deviceId)) {
        throw new TypeError("Duplicate WorkspaceKey rotation recipient");
      }
      seen.add(recipient.deviceId);
    }

    const workspaceKey = await generateWorkspaceKey();
    try {
      return await Promise.all(
        recipients.map(async (recipient) => ({
          recipientDeviceId: recipient.deviceId,
          sealedEnvelope: await sealWorkspaceKeyForDevice(
            {
              workspaceId,
              keyEpoch,
              recipientDeviceId: recipient.deviceId,
              securityHead,
            },
            workspaceKey,
            recipient.encryptionPublicKey,
          ),
        })),
      );
    } finally {
      workspaceKey.fill(0);
    }
  }

  async sealWorkspaceKeyForRecipient(
    workspaceId: WorkspaceId,
    keyEpoch: number,
    recipientDeviceId: DeviceId,
    recipientEncryptionPublicKey: Uint8Array,
    securityHead: Uint8Array,
  ): Promise<Uint8Array> {
    this.#requireOpen();
    const entry = this.#findWorkspaceKey(workspaceId, keyEpoch);
    if (!entry) {
      throw new Error(
        `WorkspaceKey epoch ${keyEpoch} is not available on this device`,
      );
    }

    return sealWorkspaceKeyForDevice(
      {
        workspaceId,
        keyEpoch,
        recipientDeviceId,
        securityHead,
      },
      entry.workspaceKey,
      recipientEncryptionPublicKey,
    );
  }

  async storeSealedWorkspaceKey(
    sealedEnvelope: Uint8Array,
    workspaceId: WorkspaceId,
    keyEpoch: number,
    securityHead: Uint8Array,
  ): Promise<void> {
    const keyMaterial = this.#requireOpen();
    const recipientDeviceId = keyMaterial.publicIdentity.deviceId;
    const workspaceKey = await openSealedWorkspaceKeyForDevice(
      sealedEnvelope,
      {
        workspaceId,
        keyEpoch,
        recipientDeviceId,
        securityHead,
      },
      keyMaterial.publicIdentity.encryptionPublicKey,
      keyMaterial.encryptionPrivateKey,
    );

    const existing = this.#findWorkspaceKey(workspaceId, keyEpoch);
    if (existing) {
      const matches = bytesEqual(existing.workspaceKey, workspaceKey);
      workspaceKey.fill(0);
      if (!matches) {
        throw new Error(
          "A different WorkspaceKey already exists for this epoch",
        );
      }
      return;
    }

    const entry: WorkspaceKeyEntry = {
      workspaceId,
      keyEpoch,
      workspaceKey,
    };
    this.#workspaceKeys.push(entry);
    sortWorkspaceKeys(this.#workspaceKeys);

    try {
      await this.#persistCurrentState();
    } catch (error) {
      this.#workspaceKeys = this.#workspaceKeys.filter(
        (candidate) => candidate !== entry,
      );
      workspaceKey.fill(0);
      throw error;
    }
  }

  async removeWorkspaceKeys(workspaceId: WorkspaceId): Promise<void> {
    this.#requireOpen();

    const removed = this.#workspaceKeys.filter(
      (entry) => entry.workspaceId === workspaceId,
    );
    if (removed.length === 0) return;

    const remaining = this.#workspaceKeys.filter(
      (entry) => entry.workspaceId !== workspaceId,
    );

    await this.#persist(
      this.#requireOpen(),
      this.#displayName,
      remaining,
    );
    this.#workspaceKeys = remaining;
    for (const entry of removed) entry.workspaceKey.fill(0);
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return signEd25519(message, this.#requireOpen().signingPrivateKey);
  }

  async close(): Promise<void> {
    if (!this.#keyMaterial) return;

    const keyMaterial = this.#keyMaterial;
    this.#keyMaterial = null;

    for (const entry of this.#workspaceKeys) {
      entry.workspaceKey.fill(0);
    }
    this.#workspaceKeys = [];

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
    await this.#persist(
      keyMaterial,
      this.#displayName,
      this.#workspaceKeys,
    );
  }

  #findWorkspaceKey(
    workspaceId: WorkspaceId,
    keyEpoch: number,
  ): WorkspaceKeyEntry | undefined {
    return this.#workspaceKeys.find(
      (entry) =>
        entry.workspaceId === workspaceId &&
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

  async unlock(): Promise<DeviceVaultSession> {
    assertWebAuthnAvailable();

    const record = await this.#db.vault.get(VAULT_RECORD_ID);
    if (!record) {
      throw new Error("Device Vault has not been set up on this device");
    }
    return this.#unlock(record);
  }

  async createWithExistingPasskey(
    displayName: string,
  ): Promise<DeviceVaultSession> {
    assertWebAuthnAvailable();
    await this.#assertVaultMissing();

    return this.#create(displayName, async (prfInput) => {
      return discoverPrfCredential(prfInput);
    });
  }

  async createWithNewPasskey(
    displayName: string,
  ): Promise<DeviceVaultSession> {
    assertWebAuthnAvailable();
    await this.#assertVaultMissing();

    return this.#create(displayName, async (prfInput) => {
      const credential = await createPrfCredential(prfInput);
      const createResult = readPrfOutput(credential);
      const prfOutput =
        createResult ??
        (await evaluatePrf(
          new Uint8Array(credential.rawId),
          prfInput,
        ));

      return { credential, prfOutput };
    });
  }

  async unlockOrCreate(displayName?: string): Promise<DeviceVaultSession> {
    return (await this.hasVault())
      ? this.unlock()
      : this.createWithNewPasskey(displayName ?? "My device");
  }

  async eraseVault(): Promise<void> {
    this.#db.close();
    await Dexie.delete(DATABASE_NAME);
  }

  async #assertVaultMissing(): Promise<void> {
    if (await this.hasVault()) {
      throw new Error("Device Vault is already set up on this device");
    }
  }

  async #create(
    displayName: string,
    obtainCredential: (
      prfInput: Uint8Array,
    ) => Promise<{
      credential: PublicKeyCredential;
      prfOutput: Uint8Array;
    }>,
  ): Promise<DeviceVaultSession> {
    const normalizedDisplayName = normalizeDeviceDisplayName(displayName);
    const keyMaterial = await generateDeviceKeyMaterial();
    const prfInput = randomBytes(PRF_INPUT_BYTES);
    let vaultKey: Uint8Array | null = null;

    try {
      const { credential, prfOutput } = await obtainCredential(prfInput);

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
      const workspaceKeys: WorkspaceKeyEntry[] = [];

      await this.#persistVault(
        recordBase,
        vaultKey,
        keyMaterial,
        normalizedDisplayName,
        workspaceKeys,
      );

      return new DeviceVaultSession(
        {
          keyMaterial,
          displayName: normalizedDisplayName,
          workspaceKeys,
        },
        vaultKey,
        (nextKeyMaterial, nextDisplayName, nextWorkspaceKeys) =>
          this.#persistVault(
            recordBase,
            vaultKey as Uint8Array,
            nextKeyMaterial,
            nextDisplayName,
            nextWorkspaceKeys,
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
        (keyMaterial, displayName, workspaceKeys) =>
          this.#persistVault(
            recordBase,
            vaultKey,
            keyMaterial,
            displayName,
            workspaceKeys,
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
    displayName: string,
    workspaceKeys: readonly WorkspaceKeyEntry[],
  ): Promise<void> {
    const plaintext = serializeDeviceVaultPayload(
      keyMaterial,
      displayName,
      workspaceKeys,
    );
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
        residentKey: "required",
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

async function discoverPrfCredential(
  prfInput: Uint8Array,
): Promise<{
  credential: PublicKeyCredential;
  prfOutput: Uint8Array;
}> {
  const extensions = {
    prf: {
      eval: {
        first: toArrayBuffer(prfInput),
      },
    },
  } as unknown as AuthenticationExtensionsClientInputs;

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32).buffer,
      timeout: WEBAUTHN_TIMEOUT_MS,
      userVerification: "required",
      extensions,
    },
  });

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("WebAuthn authentication failed");
  }

  const prfOutput = readPrfOutput(credential);
  if (!prfOutput) {
    throw new Error("This passkey does not provide WebAuthn PRF output");
  }

  return { credential, prfOutput };
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
  displayName: string,
  workspaceKeys: readonly WorkspaceKeyEntry[],
): Uint8Array {
  const payload: SerializedDeviceVaultPayload = {
    version: VAULT_PAYLOAD_VERSION,
    deviceId: keyMaterial.publicIdentity.deviceId,
    displayName: normalizeDeviceDisplayName(displayName),
    encryptionPublicKey: bytesToHex(
      keyMaterial.publicIdentity.encryptionPublicKey,
    ),
    encryptionPrivateKey: bytesToHex(keyMaterial.encryptionPrivateKey),
    signingPublicKey: bytesToHex(keyMaterial.publicIdentity.signingPublicKey),
    signingPrivateKey: bytesToHex(keyMaterial.signingPrivateKey),
    workspaceKeys: workspaceKeys.map((entry) => ({
      workspaceId: entry.workspaceId,
      keyEpoch: entry.keyEpoch,
      workspaceKey: bytesToHex(entry.workspaceKey),
    })),
  };

  return new TextEncoder().encode(JSON.stringify(payload));
}

export function deserializeDeviceVaultPayload(
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

  if (
    parsed.version !== VAULT_PAYLOAD_VERSION ||
    !("displayName" in parsed) ||
    typeof parsed.displayName !== "string" ||
    !("workspaceKeys" in parsed) ||
    !Array.isArray(parsed.workspaceKeys)
  ) {
    throw new Error("Unsupported Device Vault payload version");
  }

  const displayName = normalizeDeviceDisplayName(parsed.displayName);

  const workspaceKeys = parsed.workspaceKeys.map(parseWorkspaceKeyEntry);
  const seen = new Set<string>();
  for (const entry of workspaceKeys) {
    const identity = `${entry.workspaceId}:${entry.keyEpoch}`;
    if (seen.has(identity)) {
      throw new Error("Duplicate WorkspaceKey entry in Device Vault");
    }
    seen.add(identity);
  }
  sortWorkspaceKeys(workspaceKeys);

  return {
    keyMaterial,
    displayName,
    workspaceKeys,
  };
}

function isBaseVaultPayload(
  parsed: unknown,
): parsed is SerializedDeviceVaultPayload {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    parsed.version === VAULT_PAYLOAD_VERSION &&
    "deviceId" in parsed &&
    typeof parsed.deviceId === "string" &&
    "displayName" in parsed &&
    typeof parsed.displayName === "string" &&
    "encryptionPublicKey" in parsed &&
    typeof parsed.encryptionPublicKey === "string" &&
    "encryptionPrivateKey" in parsed &&
    typeof parsed.encryptionPrivateKey === "string" &&
    "signingPublicKey" in parsed &&
    typeof parsed.signingPublicKey === "string" &&
    "signingPrivateKey" in parsed &&
    typeof parsed.signingPrivateKey === "string" &&
    "workspaceKeys" in parsed &&
    Array.isArray(parsed.workspaceKeys)
  );
}

function parseWorkspaceKeyEntry(value: unknown): WorkspaceKeyEntry {
  if (
    typeof value !== "object" ||
    value === null ||
    !("workspaceId" in value) ||
    typeof value.workspaceId !== "string" ||
    !("keyEpoch" in value) ||
    typeof value.keyEpoch !== "number" ||
    !Number.isSafeInteger(value.keyEpoch) ||
    value.keyEpoch < 1 ||
    !("workspaceKey" in value) ||
    typeof value.workspaceKey !== "string"
  ) {
    throw new Error("Invalid WorkspaceKey entry in Device Vault");
  }

  return {
    workspaceId: parseWorkspaceId(value.workspaceId),
    keyEpoch: value.keyEpoch,
    workspaceKey: hexToBytes(value.workspaceKey, PROJECT_KEY_BYTES),
  };
}

function sortWorkspaceKeys(workspaceKeys: WorkspaceKeyEntry[]): void {
  workspaceKeys.sort((left, right) => {
    const workspaceOrder = left.workspaceId.localeCompare(right.workspaceId);
    return workspaceOrder !== 0
      ? workspaceOrder
      : left.keyEpoch - right.keyEpoch;
  });
}

function assertKeyEpoch(keyEpoch: number): void {
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) {
    throw new TypeError("WorkspaceKey epoch must be a positive safe integer");
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

function normalizeDeviceDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized) {
    throw new TypeError("Device name must not be empty");
  }
  if (normalized.length > 80) {
    throw new TypeError("Device name must be 80 characters or fewer");
  }
  return normalized;
}
