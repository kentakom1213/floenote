import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("persists an edited note across reload and Device Vault unlock", async ({
  page,
}) => {
  await createSecuredProject(page, "Persistence Project");

  const editor = page.locator('.editor [contenteditable="true"]');
  await expect(editor).toBeVisible();

  const before = await readEncryptedDocumentSnapshot(page);
  await editor.fill("This body survives an encrypted IndexedDB reload.");

  await expect(editor).toContainText(
    "This body survives an encrypted IndexedDB reload.",
  );
  await expect
    .poll(() => readEncryptedDocumentSnapshot(page))
    .not.toEqual(before);

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

async function readEncryptedDocumentSnapshot(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("floe-note");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    try {
      const transaction = database.transaction("documents", "readonly");
      const store = transaction.objectStore("documents");
      const getAllRequest = store.getAll();
      const rows = await new Promise<
        { encryptedSnapshot?: Uint8Array | ArrayBuffer }[]
      >((resolve, reject) => {
        getAllRequest.onerror = () => reject(getAllRequest.error);
        getAllRequest.onsuccess = () => resolve(getAllRequest.result);
      });

      const encrypted = rows[0]?.encryptedSnapshot;
      if (!encrypted) return null;

      const bytes =
        encrypted instanceof Uint8Array
          ? encrypted
          : new Uint8Array(encrypted);
      return Array.from(bytes).join(",");
    } finally {
      database.close();
    }
  });
}
