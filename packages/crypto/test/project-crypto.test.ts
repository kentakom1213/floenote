import {
  createDeviceId,
  createDocumentId,
  createProjectId,
} from "@floe-note/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  decryptProjectStoragePayload,
  decryptProjectSyncPayload,
  destroyDeviceKeyMaterial,
  encryptProjectStoragePayload,
  encryptProjectSyncPayload,
  generateDeviceKeyMaterial,
  generateProjectKey,
  openSealedProjectKeyForDevice,
  readProjectStoragePayloadKeyEpoch,
  readProjectSyncPayloadKeyEpoch,
  sealProjectKeyForDevice,
  type DeviceKeyMaterial,
} from "../src/index.js";

const keyMaterials: DeviceKeyMaterial[] = [];

afterEach(async () => {
  await Promise.all(keyMaterials.splice(0).map(destroyDeviceKeyMaterial));
});

describe("ProjectKey delivery", () => {
  it("opens only with the expected recipient context", async () => {
    const recipient = await generateDeviceKeyMaterial();
    keyMaterials.push(recipient);

    const projectId = createProjectId();
    const projectKey = await generateProjectKey();
    const securityHead = new Uint8Array(32).fill(9);
    const context = {
      projectId,
      keyEpoch: 3,
      recipientDeviceId: recipient.publicIdentity.deviceId,
      securityHead,
    };

    const sealed = await sealProjectKeyForDevice(
      context,
      projectKey,
      recipient.publicIdentity.encryptionPublicKey,
    );
    const opened = await openSealedProjectKeyForDevice(
      sealed,
      context,
      recipient.publicIdentity.encryptionPublicKey,
      recipient.encryptionPrivateKey,
    );

    expect(opened).toEqual(projectKey);

    await expect(
      openSealedProjectKeyForDevice(
        sealed,
        {
          ...context,
          recipientDeviceId: createDeviceId(),
        },
        recipient.publicIdentity.encryptionPublicKey,
        recipient.encryptionPrivateKey,
      ),
    ).rejects.toThrow("ProjectKey envelope context does not match pairing");

    projectKey.fill(0);
    opened.fill(0);
  });
});

describe("encrypted Project sync", () => {
  it("round-trips and authenticates the Project and key epoch", async () => {
    const projectId = createProjectId();
    const projectKey = await generateProjectKey();
    const plaintext = new TextEncoder().encode("hello encrypted sync");

    const envelope = await encryptProjectSyncPayload(
      projectId,
      4,
      projectKey,
      plaintext,
    );

    expect(readProjectSyncPayloadKeyEpoch(envelope)).toBe(4);
    await expect(
      decryptProjectSyncPayload(projectId, projectKey, envelope),
    ).resolves.toEqual(plaintext);

    const tampered = envelope.slice();
    tampered[tampered.length - 1] ^= 0xff;
    await expect(
      decryptProjectSyncPayload(projectId, projectKey, tampered),
    ).rejects.toThrow("Could not authenticate encrypted Project sync payload");

    await expect(
      decryptProjectSyncPayload(createProjectId(), projectKey, envelope),
    ).rejects.toThrow("Could not authenticate encrypted Project sync payload");

    projectKey.fill(0);
  });
});

describe("encrypted Project storage", () => {
  it("round-trips and rejects epoch or record-context mismatch", async () => {
    const projectId = createProjectId();
    const documentId = createDocumentId();
    const projectKey = await generateProjectKey();
    const plaintext = new TextEncoder().encode("persistent note state");
    const context = {
      kind: "document" as const,
      documentId,
    };

    const envelope = await encryptProjectStoragePayload(
      projectId,
      5,
      context,
      projectKey,
      plaintext,
    );

    expect(readProjectStoragePayloadKeyEpoch(envelope)).toBe(5);
    await expect(
      decryptProjectStoragePayload(
        projectId,
        5,
        context,
        projectKey,
        envelope,
      ),
    ).resolves.toEqual(plaintext);

    await expect(
      decryptProjectStoragePayload(
        projectId,
        4,
        context,
        projectKey,
        envelope,
      ),
    ).rejects.toThrow("uses key epoch 5, expected 4");

    await expect(
      decryptProjectStoragePayload(
        projectId,
        5,
        { kind: "manifest" },
        projectKey,
        envelope,
      ),
    ).rejects.toThrow("Could not authenticate encrypted Project storage payload");

    projectKey.fill(0);
  });
});
