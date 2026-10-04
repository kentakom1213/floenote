import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("persists an edited note across reload and Device Vault unlock", async ({
  page,
}) => {
  const { projectId: workspaceId, documentId } = await createSecuredProject(
    page,
    "Persistence Project",
  );

  const editor = page.locator('.editor [contenteditable="true"]');
  await expect(editor).toBeVisible();

  await expect
    .poll(() =>
      readEncryptedDocumentSnapshotLength(page, workspaceId, documentId),
    )
    .not.toBeNull();
  const beforeLength = await readEncryptedDocumentSnapshotLength(
    page,
    workspaceId,
    documentId,
  );

  await editor.fill("This body survives an encrypted IndexedDB reload.");

  await expect(editor).toContainText(
    "This body survives an encrypted IndexedDB reload.",
  );
  await expect
    .poll(() =>
      readEncryptedDocumentSnapshotLength(page, workspaceId, documentId),
    )
    .not.toBe(beforeLength);

  const persisted = await page.evaluate(
    async ({ workspaceId, documentId }) => {
      const request = indexedDB.open("floe-note-workspaces");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      try {
        const transaction = database.transaction(
          ["workspaces", "manifests", "documents", "security"],
        );
        const get = (store: string, key: IDBValidKey) =>
          new Promise<Record<string, unknown> | null>((resolve, reject) => {
            const request = transaction.objectStore(store).get(key);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result ?? null);
          });
        const otherWorkspaceId = "01999999-9999-7999-8999-999999999999";
        const [
          metadata,
          manifest,
          document,
          security,
          otherManifest,
          otherDocument,
        ] = await Promise.all([
          get("workspaces", workspaceId),
          get("manifests", workspaceId),
          get("documents", [workspaceId, documentId]),
          get("security", workspaceId),
          get("manifests", otherWorkspaceId),
          get("documents", [otherWorkspaceId, documentId]),
        ]);
        return {
          version: database.version,
          stores: Array.from(database.objectStoreNames),
          metadata,
          manifest,
          document,
          security,
          otherManifest,
          otherDocument,
        };
      } finally {
        database.close();
      }
    },
    { workspaceId, documentId },
  );
  // Dexie maps schema version 3 to IndexedDB version 30.
  expect(persisted.version).toBe(30);
  expect(persisted.stores).toEqual([
    "documents",
    "manifests",
    "replicationObservations",
    "security",
    "workspaces",
  ]);
  expect(persisted.metadata).toMatchObject({ workspaceId });
  expect(persisted.manifest).toMatchObject({ workspaceId });
  expect(persisted.document).toMatchObject({ workspaceId, documentId });
  expect(persisted.security).toMatchObject({ workspaceId });
  expect(persisted.manifest?.encryptedSnapshot).toBeTruthy();
  expect(persisted.document?.encryptedSnapshot).toBeTruthy();
  expect(persisted.manifest).not.toHaveProperty("snapshot");
  expect(persisted.document).not.toHaveProperty("snapshot");
  expect(persisted.otherManifest).toBeNull();
  expect(persisted.otherDocument).toBeNull();

  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Unlock Floe Note" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();

  await expect(page.getByLabel("Note title")).toHaveValue(
    "Welcome to Floe Note",
  );
  await expect(page.locator('.editor [contenteditable="true"]')).toContainText(
    "This body survives an encrypted IndexedDB reload.",
  );

  await page.locator('.editor [contenteditable="true"]').fill(
    "A second edit creates a durable checkpoint.",
  );
  await page.getByRole("button", { name: "New note" }).click();
  await page
    .getByRole("navigation", { name: "Notes" })
    .getByRole("button", { name: "Welcome to Floe Note" })
    .click();
  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(
    page.locator(".edit-history-list .edit-history-item"),
  ).toHaveCount(2);

  await page.reload();
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(
    page.locator(".edit-history-list .edit-history-item"),
  ).toHaveCount(2);

  await page.getByRole("button", { name: "Current" }).click();
  await page.locator('.editor [contenteditable="true"]').fill(
    "Current body differs from the recovery version.",
  );
  await page.locator(".edit-history-list .edit-history-item").nth(1).click();

  const historicalDiff = page.locator(".historical-inline-diff");
  await expect(historicalDiff).toBeVisible();
  await expect(page.locator(".historical-diff-removed")).toBeVisible();
  await expect(page.locator(".historical-diff-added")).toBeVisible();

  await page.getByRole("button", { name: "Back to current" }).click();
  await page
    .getByRole("group", { name: "Note view" })
    .getByRole("button", { name: "Split" })
    .click();
  await page.locator(".edit-history-list .edit-history-item").nth(1).click();

  await expect(historicalDiff).toBeVisible();
  await expect(page.locator(".historical-diff-removed")).toBeVisible();
  await expect(page.locator(".historical-diff-added")).toBeVisible();
  await expect(page.locator(".document-current-view")).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });

  const restoreButton = page.getByRole("button", {
    name: "Restore this version",
  });
  await expect(restoreButton).toBeVisible();

  const [historyPanelBox, restoreButtonBox] = await Promise.all([
    page.locator(".edit-history-panel").boundingBox(),
    restoreButton.boundingBox(),
  ]);
  expect(historyPanelBox).not.toBeNull();
  expect(restoreButtonBox).not.toBeNull();
  expect(historyPanelBox!.y).toBeGreaterThanOrEqual(
    restoreButtonBox!.y + restoreButtonBox!.height,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await restoreButton.click();
  const restoredTitle = page.getByLabel("Note title");
  await expect(restoredTitle).toHaveValue("Welcome to Floe Note");
  await expect(restoredTitle).toBeVisible();
  expect((await restoredTitle.boundingBox())?.height ?? 0).toBeGreaterThan(0);
});

test("resets pre-Project Workspace schema v1 before creating fresh data", async ({
  page,
}) => {
  await page.route("http://localhost:4173/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/");

  const oldWorkspaceId = "01999999-9999-7999-8999-999999999999";
  const oldDocumentId = "01999999-9999-7999-8999-999999999998";
  await page.evaluate(async ({ workspaceId, documentId }) => {
    // Dexie v1 uses IndexedDB version 10.
    const request = indexedDB.open("floe-note-workspaces", 10);
    request.onupgradeneeded = () => {
      const database = request.result;
      const workspaces = database.createObjectStore("workspaces", {
        keyPath: "workspaceId",
      });
      workspaces.createIndex("localSlot", "localSlot", { unique: true });
      workspaces.createIndex("createdAt", "createdAt");
      database.createObjectStore("manifests", { keyPath: "workspaceId" });
      const documents = database.createObjectStore("documents", {
        keyPath: ["workspaceId", "documentId"],
      });
      documents.createIndex("workspaceId", "workspaceId");
      documents.createIndex("documentId", "documentId");
      database.createObjectStore("security", { keyPath: "workspaceId" });
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = database.transaction(
        ["workspaces", "manifests", "documents", "security"],
        "readwrite",
      );
      transaction.objectStore("workspaces").put({
        workspaceId,
        localSlot: "default",
        createdAt: 1,
      });
      transaction.objectStore("manifests").put({
        workspaceId,
        encryptedSnapshot: Uint8Array.of(1, 2, 3),
      });
      transaction.objectStore("documents").put({
        workspaceId,
        documentId,
        encryptedSnapshot: Uint8Array.of(4, 5, 6),
      });
      transaction.objectStore("security").put({ workspaceId });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, { workspaceId: oldWorkspaceId, documentId: oldDocumentId });

  await page.unroute("http://localhost:4173/");
  const { projectId: newWorkspaceId, documentId: newDocumentId } =
    await createSecuredProject(page, "Fresh Workspace");

  const persisted = await page.evaluate(
    async ({ oldWorkspaceId, oldDocumentId, newWorkspaceId, newDocumentId }) => {
      const request = indexedDB.open("floe-note-workspaces");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      try {
        const transaction = database.transaction(
          ["workspaces", "manifests", "documents", "security"],
        );
        const get = (store: string, key: IDBValidKey) =>
          new Promise<unknown>((resolve, reject) => {
            const request = transaction.objectStore(store).get(key);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result ?? null);
          });
        const rows = await Promise.all([
          get("workspaces", oldWorkspaceId),
          get("manifests", oldWorkspaceId),
          get("documents", [oldWorkspaceId, oldDocumentId]),
          get("security", oldWorkspaceId),
          get("workspaces", newWorkspaceId),
          get("manifests", newWorkspaceId),
          get("documents", [newWorkspaceId, newDocumentId]),
          get("security", newWorkspaceId),
        ]);
        return {
          version: database.version,
          oldRows: rows.slice(0, 4),
          newRows: rows.slice(4),
        };
      } finally {
        database.close();
      }
    },
    { oldWorkspaceId, oldDocumentId, newWorkspaceId, newDocumentId },
  );

  expect(persisted.version).toBe(30);
  expect(persisted.oldRows).toEqual([null, null, null, null]);
  expect(persisted.newRows.every((row) => row !== null)).toBe(true);
});

test("does not interpret the pre-Workspace IndexedDB as Workspace data", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const workspaceId = "01999999-9999-7999-8999-999999999999";
    const request = indexedDB.open("floe-note", 3);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("projects", { keyPath: "id" });
        database.createObjectStore("manifests", { keyPath: "projectId" });
        database.createObjectStore("documents", {
          keyPath: ["projectId", "documentId"],
        });
        database.createObjectStore("security", { keyPath: "workspaceId" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    try {
      const transaction = database.transaction(
        ["projects", "manifests"],
        "readwrite",
      );
      transaction.objectStore("projects").put({
        id: workspaceId,
        localSlot: "default",
        createdAt: 1,
      });
      transaction.objectStore("manifests").put({
        projectId: workspaceId,
        snapshot: new TextEncoder().encode("old plaintext snapshot"),
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Choose how to begin" }),
  ).toBeVisible();

  const { projectId: newWorkspaceId } = await createSecuredProject(
    page,
    "Fresh Workspace",
  );
  const persistedWorkspaceIds = await page.evaluate(async () => {
    const request = indexedDB.open("floe-note-workspaces");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const getAllKeys = database
        .transaction("workspaces")
        .objectStore("workspaces")
        .getAllKeys();
      return await new Promise<IDBValidKey[]>((resolve, reject) => {
        getAllKeys.onerror = () => reject(getAllKeys.error);
        getAllKeys.onsuccess = () => resolve(getAllKeys.result);
      });
    } finally {
      database.close();
    }
  });
  expect(persistedWorkspaceIds).toEqual([newWorkspaceId]);
});

test("does not open another Workspace's encrypted manifest", async ({
  page,
}) => {
  const { projectId: sourceWorkspaceId } = await createSecuredProject(
    page,
    "Source Workspace",
  );
  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: "New workspace" }).click();
  await page.getByRole("button", { name: /Create new workspace/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Target Workspace");
  const commit = page.waitForResponse((response) =>
    /\/workspaces\/[^/]+\/security\/transitions$/.test(response.url()) &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create workspace" }).click();
  expect((await commit).status()).toBe(201);
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/n\/[0-9a-f-]+$/);
  const targetWorkspaceId = new URL(page.url()).pathname.split("/")[2]!;
  expect(targetWorkspaceId).not.toBe(sourceWorkspaceId);

  await expect.poll(() =>
    readEncryptedManifestSnapshotLength(page, targetWorkspaceId),
  ).not.toBeNull();
  await page.evaluate(async ({ sourceWorkspaceId, targetWorkspaceId }) => {
    const request = indexedDB.open("floe-note-workspaces");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = database.transaction("manifests", "readwrite");
      const store = transaction.objectStore("manifests");
      const sourceRequest = store.get(sourceWorkspaceId);
      const source = await new Promise<{ encryptedSnapshot: Uint8Array }>(
        (resolve, reject) => {
          sourceRequest.onerror = () => reject(sourceRequest.error);
          sourceRequest.onsuccess = () => resolve(sourceRequest.result);
        },
      );
      store.put({
        workspaceId: targetWorkspaceId,
        encryptedSnapshot: source.encryptedSnapshot,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, { sourceWorkspaceId, targetWorkspaceId });

  await page.reload();
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page.locator(".dialog-error")).toContainText(
    "Could not authenticate encrypted Workspace storage payload",
  );
});

async function readEncryptedManifestSnapshotLength(
  page: Page,
  workspaceId: string,
): Promise<number | null> {
  return page.evaluate(async (workspaceId) => {
    const request = indexedDB.open("floe-note-workspaces");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const get = database
        .transaction("manifests")
        .objectStore("manifests")
        .get(workspaceId);
      return await new Promise<number | null>((resolve, reject) => {
        get.onerror = () => reject(get.error);
        get.onsuccess = () =>
          resolve(get.result?.encryptedSnapshot?.byteLength ?? null);
      });
    } finally {
      database.close();
    }
  }, workspaceId);
}

async function readEncryptedDocumentSnapshotLength(
  page: Page,
  workspaceId: string,
  documentId: string,
): Promise<number | null> {
  return page.evaluate(
    async ({ workspaceId, documentId }) => {
      const request = indexedDB.open("floe-note-workspaces");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      try {
        const transaction = database.transaction("documents", "readonly");
        const store = transaction.objectStore("documents");
        const getRequest = store.get([workspaceId, documentId]);
        const row = await new Promise<
          { encryptedSnapshot?: Uint8Array | ArrayBuffer } | undefined
        >((resolve, reject) => {
          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => resolve(getRequest.result);
        });

        return row?.encryptedSnapshot?.byteLength ?? null;
      } finally {
        database.close();
      }
    },
    { workspaceId, documentId },
  );
}
