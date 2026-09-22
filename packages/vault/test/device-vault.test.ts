import {
  DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES,
  DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
  DEVICE_SIGNING_PRIVATE_KEY_BYTES,
  DEVICE_SIGNING_PUBLIC_KEY_BYTES,
  PROJECT_KEY_BYTES,
  generateDeviceKeyMaterial,
} from "@floe-note/crypto";
import { createDeviceId, createProjectId } from "@floe-note/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  DeviceVaultSession,
  deserializeDeviceVaultPayload,
} from "../src/web-authn-prf-device-vault.js";

const sessions: DeviceVaultSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

function encodedPayload(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function keyMaterialPayload(version: 1 | 2 | 3) {
  return {
    version,
    deviceId: createDeviceId(),
    encryptionPublicKey: "11".repeat(DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES),
    encryptionPrivateKey: "22".repeat(DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES),
    signingPublicKey: "33".repeat(DEVICE_SIGNING_PUBLIC_KEY_BYTES),
    signingPrivateKey: "44".repeat(DEVICE_SIGNING_PRIVATE_KEY_BYTES),
  };
}

describe("Device Vault payload compatibility", () => {
  it("loads v1 payloads with the legacy default device name", () => {
    const contents = deserializeDeviceVaultPayload(
      encodedPayload(keyMaterialPayload(1)),
    );

    expect(contents.displayName).toBe("My device");
    expect(contents.projectKeys).toEqual([]);
  });

  it("loads v2 ProjectKeys and supplies the legacy default device name", () => {
    const projectId = createProjectId();
    const contents = deserializeDeviceVaultPayload(
      encodedPayload({
        ...keyMaterialPayload(2),
        projectKeys: [
          {
            projectId,
            keyEpoch: 2,
            projectKey: "55".repeat(PROJECT_KEY_BYTES),
          },
        ],
      }),
    );

    expect(contents.displayName).toBe("My device");
    expect(contents.projectKeys).toHaveLength(1);
    expect(contents.projectKeys[0]?.projectId).toBe(projectId);
    expect(contents.projectKeys[0]?.keyEpoch).toBe(2);
  });

  it("loads and normalizes the v3 display name", () => {
    const contents = deserializeDeviceVaultPayload(
      encodedPayload({
        ...keyMaterialPayload(3),
        displayName: "  Kenta's Laptop  ",
        projectKeys: [],
      }),
    );

    expect(contents.displayName).toBe("Kenta's Laptop");
  });

  it("rejects duplicate ProjectKeys in a persisted payload", () => {
    const projectId = createProjectId();
    const projectKey = "66".repeat(PROJECT_KEY_BYTES);

    expect(() =>
      deserializeDeviceVaultPayload(
        encodedPayload({
          ...keyMaterialPayload(2),
          projectKeys: [
            { projectId, keyEpoch: 1, projectKey },
            { projectId, keyEpoch: 1, projectKey },
          ],
        }),
      ),
    ).toThrow("Duplicate ProjectKey entry in Device Vault");
  });
});

describe("DeviceVaultSession", () => {
  it("persists a normalized device name before updating the session", async () => {
    const keyMaterial = await generateDeviceKeyMaterial();
    const persistedNames: string[] = [];
    const session = new DeviceVaultSession(
      {
        keyMaterial,
        displayName: "Laptop",
        projectKeys: [],
      },
      new Uint8Array(32).fill(7),
      async (_nextKeyMaterial, displayName) => {
        persistedNames.push(displayName);
      },
    );
    sessions.push(session);

    await session.renameDevice("  Work Laptop  ");

    expect(session.displayName).toBe("Work Laptop");
    expect(persistedNames).toEqual(["Work Laptop"]);
  });

  it("keeps the old device name when persistence fails", async () => {
    const keyMaterial = await generateDeviceKeyMaterial();
    const session = new DeviceVaultSession(
      {
        keyMaterial,
        displayName: "Laptop",
        projectKeys: [],
      },
      new Uint8Array(32).fill(7),
      async () => {
        throw new Error("storage failed");
      },
    );
    sessions.push(session);

    await expect(session.renameDevice("Work Laptop")).rejects.toThrow(
      "storage failed",
    );
    expect(session.displayName).toBe("Laptop");
  });

  it("removes only ProjectKeys belonging to the selected Project", async () => {
    const keyMaterial = await generateDeviceKeyMaterial();
    const firstProjectId = createProjectId();
    const secondProjectId = createProjectId();
    const persistedProjects: string[][] = [];

    const session = new DeviceVaultSession(
      {
        keyMaterial,
        displayName: "Laptop",
        projectKeys: [],
      },
      new Uint8Array(32).fill(7),
      async (_nextKeyMaterial, _displayName, projectKeys) => {
        persistedProjects.push(
          projectKeys.map((entry) => entry.projectId),
        );
      },
    );
    sessions.push(session);

    await session.createProjectKeyIfMissing(firstProjectId, 1);
    await session.createProjectKeyIfMissing(secondProjectId, 1);
    await session.removeProjectKeys(firstProjectId);

    expect(session.hasProjectKey(firstProjectId, 1)).toBe(false);
    expect(session.hasProjectKey(secondProjectId, 1)).toBe(true);
    expect(persistedProjects.at(-1)).toEqual([secondProjectId]);
  });
});
