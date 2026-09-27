import {
  createDeviceId,
  createDocumentId,
  createWorkspaceId,
} from "@floe-note/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  decryptWorkspaceStoragePayload,
  decryptWorkspaceSyncPayload,
  destroyDeviceKeyMaterial,
  encryptWorkspaceStoragePayload,
  encryptWorkspaceSyncPayload,
  generateDeviceKeyMaterial,
  generateWorkspaceKey,
  openSealedWorkspaceKeyForDevice,
  readWorkspaceStoragePayloadKeyEpoch,
  readWorkspaceSyncPayloadKeyEpoch,
  sealWorkspaceKeyForDevice,
  type DeviceKeyMaterial,
} from "../src/index.js";

const keyMaterials: DeviceKeyMaterial[] = [];

afterEach(async () => {
  await Promise.all(keyMaterials.splice(0).map(destroyDeviceKeyMaterial));
});

describe("WorkspaceKey delivery", () => {
  it("opens only with the expected recipient context", async () => {
    const recipient = await generateDeviceKeyMaterial();
    keyMaterials.push(recipient);

    const workspaceId = createWorkspaceId();
    const workspaceKey = await generateWorkspaceKey();
    const securityHead = new Uint8Array(32).fill(9);
    const context = {
      workspaceId,
      keyEpoch: 3,
      recipientDeviceId: recipient.publicIdentity.deviceId,
      securityHead,
    };

    const sealed = await sealWorkspaceKeyForDevice(
      context,
      workspaceKey,
      recipient.publicIdentity.encryptionPublicKey,
    );
    const opened = await openSealedWorkspaceKeyForDevice(
      sealed,
      context,
      recipient.publicIdentity.encryptionPublicKey,
      recipient.encryptionPrivateKey,
    );

    expect(opened).toEqual(workspaceKey);

    await expect(
      openSealedWorkspaceKeyForDevice(
        sealed,
        {
          ...context,
          recipientDeviceId: createDeviceId(),
        },
        recipient.publicIdentity.encryptionPublicKey,
        recipient.encryptionPrivateKey,
      ),
    ).rejects.toThrow("WorkspaceKey envelope context does not match pairing");

    await expect(
      openSealedWorkspaceKeyForDevice(
        sealed,
        {
          ...context,
          workspaceId: createWorkspaceId(),
        },
        recipient.publicIdentity.encryptionPublicKey,
        recipient.encryptionPrivateKey,
      ),
    ).rejects.toThrow("WorkspaceKey envelope context does not match pairing");

    workspaceKey.fill(0);
    opened.fill(0);
  });
});

describe("encrypted Workspace sync", () => {
  it("round-trips and authenticates the Workspace and key epoch", async () => {
    const workspaceId = createWorkspaceId();
    const workspaceKey = await generateWorkspaceKey();
    const plaintext = new TextEncoder().encode("hello encrypted sync");

    const envelope = await encryptWorkspaceSyncPayload(
      workspaceId,
      4,
      workspaceKey,
      plaintext,
    );

    expect(readWorkspaceSyncPayloadKeyEpoch(envelope)).toBe(4);
    await expect(
      decryptWorkspaceSyncPayload(workspaceId, workspaceKey, envelope),
    ).resolves.toEqual(plaintext);

    const tampered = envelope.slice();
    tampered[tampered.length - 1] ^= 0xff;
    await expect(
      decryptWorkspaceSyncPayload(workspaceId, workspaceKey, tampered),
    ).rejects.toThrow("Could not authenticate encrypted Workspace sync payload");

    await expect(
      decryptWorkspaceSyncPayload(createWorkspaceId(), workspaceKey, envelope),
    ).rejects.toThrow("Could not authenticate encrypted Workspace sync payload");

    workspaceKey.fill(0);
  });
});

describe("encrypted Workspace storage", () => {
  it("round-trips and rejects epoch or record-context mismatch", async () => {
    const workspaceId = createWorkspaceId();
    const documentId = createDocumentId();
    const workspaceKey = await generateWorkspaceKey();
    const plaintext = new TextEncoder().encode("persistent note state");
    const context = {
      kind: "document" as const,
      documentId,
    };

    const envelope = await encryptWorkspaceStoragePayload(
      workspaceId,
      5,
      context,
      workspaceKey,
      plaintext,
    );

    expect(readWorkspaceStoragePayloadKeyEpoch(envelope)).toBe(5);
    await expect(
      decryptWorkspaceStoragePayload(
        workspaceId,
        5,
        context,
        workspaceKey,
        envelope,
      ),
    ).resolves.toEqual(plaintext);

    await expect(
      decryptWorkspaceStoragePayload(
        workspaceId,
        4,
        context,
        workspaceKey,
        envelope,
      ),
    ).rejects.toThrow("uses key epoch 5, expected 4");

    await expect(
      decryptWorkspaceStoragePayload(
        workspaceId,
        5,
        { kind: "manifest" },
        workspaceKey,
        envelope,
      ),
    ).rejects.toThrow("Could not authenticate encrypted Workspace storage payload");

    await expect(
      decryptWorkspaceStoragePayload(
        createWorkspaceId(),
        5,
        context,
        workspaceKey,
        envelope,
      ),
    ).rejects.toThrow("Could not authenticate encrypted Workspace storage payload");

    workspaceKey.fill(0);
  });
});
