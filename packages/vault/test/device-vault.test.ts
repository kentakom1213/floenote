import {
  DEVICE_ENCRYPTION_PRIVATE_KEY_BYTES,
  DEVICE_ENCRYPTION_PUBLIC_KEY_BYTES,
  DEVICE_SIGNING_PRIVATE_KEY_BYTES,
  DEVICE_SIGNING_PUBLIC_KEY_BYTES,
  PROJECT_KEY_BYTES,
  generateDeviceKeyMaterial,
} from "@floe-note/crypto";
import { createDeviceId, createWorkspaceId } from "@floe-note/domain";
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
    expect(contents.workspaceKeys).toEqual([]);
  });

  it("loads v2 WorkspaceKeys and supplies the legacy default device name", () => {
    const workspaceId = createWorkspaceId();
    const contents = deserializeDeviceVaultPayload(
      encodedPayload({
        ...keyMaterialPayload(2),
        workspaceKeys: [
          {
            workspaceId,
            keyEpoch: 2,
            workspaceKey: "55".repeat(PROJECT_KEY_BYTES),
          },
        ],
      }),
    );

    expect(contents.displayName).toBe("My device");
    expect(contents.workspaceKeys).toHaveLength(1);
    expect(contents.workspaceKeys[0]?.workspaceId).toBe(workspaceId);
    expect(contents.workspaceKeys[0]?.keyEpoch).toBe(2);
  });

  it("loads and normalizes the v3 display name", () => {
    const contents = deserializeDeviceVaultPayload(
      encodedPayload({
        ...keyMaterialPayload(3),
        displayName: "  Kenta's Laptop  ",
        workspaceKeys: [],
      }),
    );

    expect(contents.displayName).toBe("Kenta's Laptop");
  });

  it("rejects duplicate WorkspaceKeys in a persisted payload", () => {
    const workspaceId = createWorkspaceId();
    const workspaceKey = "66".repeat(PROJECT_KEY_BYTES);

    expect(() =>
      deserializeDeviceVaultPayload(
        encodedPayload({
          ...keyMaterialPayload(2),
          workspaceKeys: [
            { workspaceId, keyEpoch: 1, workspaceKey },
            { workspaceId, keyEpoch: 1, workspaceKey },
          ],
        }),
      ),
    ).toThrow("Duplicate WorkspaceKey entry in Device Vault");
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
        workspaceKeys: [],
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
        workspaceKeys: [],
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

  it("removes only WorkspaceKeys belonging to the selected Workspace", async () => {
    const keyMaterial = await generateDeviceKeyMaterial();
    const firstWorkspaceId = createWorkspaceId();
    const secondWorkspaceId = createWorkspaceId();
    const persistedWorkspaces: string[][] = [];

    const session = new DeviceVaultSession(
      {
        keyMaterial,
        displayName: "Laptop",
        workspaceKeys: [],
      },
      new Uint8Array(32).fill(7),
      async (_nextKeyMaterial, _displayName, workspaceKeys) => {
        persistedWorkspaces.push(
          workspaceKeys.map((entry) => entry.workspaceId),
        );
      },
    );
    sessions.push(session);

    await session.createWorkspaceKeyIfMissing(firstWorkspaceId, 1);
    await session.createWorkspaceKeyIfMissing(secondWorkspaceId, 1);
    await session.removeWorkspaceKeys(firstWorkspaceId);

    expect(session.hasWorkspaceKey(firstWorkspaceId, 1)).toBe(false);
    expect(session.hasWorkspaceKey(secondWorkspaceId, 1)).toBe(true);
    expect(persistedWorkspaces.at(-1)).toEqual([secondWorkspaceId]);
  });
});
