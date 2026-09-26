import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("persists an edited note across reload and Device Vault unlock", async ({
  page,
}) => {
  const { projectId, documentId } = await createSecuredProject(
    page,
    "Persistence Project",
  );

  const editor = page.locator('.editor [contenteditable="true"]');
  await expect(editor).toBeVisible();

  await expect
    .poll(() =>
      readEncryptedDocumentSnapshotLength(page, projectId, documentId),
    )
    .not.toBeNull();
  const beforeLength = await readEncryptedDocumentSnapshotLength(
    page,
    projectId,
    documentId,
  );

  await editor.fill("This body survives an encrypted IndexedDB reload.");

  await expect(editor).toContainText(
    "This body survives an encrypted IndexedDB reload.",
  );
  await expect
    .poll(() =>
      readEncryptedDocumentSnapshotLength(page, projectId, documentId),
    )
    .not.toBe(beforeLength);

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
});

async function readEncryptedDocumentSnapshotLength(
  page: Page,
  projectId: string,
  documentId: string,
): Promise<number | null> {
  return page.evaluate(
    async ({ projectId, documentId }) => {
      const request = indexedDB.open("floe-note");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      try {
        const transaction = database.transaction("documents", "readonly");
        const store = transaction.objectStore("documents");
        const getRequest = store.get([projectId, documentId]);
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
    { projectId, documentId },
  );
}
