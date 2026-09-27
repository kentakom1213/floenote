import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("keeps visible views and browser history aligned", async ({ page }) => {
  const { projectId, documentId } = await createSecuredProject(
    page,
    "Navigation Project",
  );
  const documentPath = `/w/${projectId}/n/${documentId}`;

  await page.getByLabel("Switch project").click();
  await page.getByRole("button", { name: "Project settings" }).click();

  await expect(page).toHaveURL(`/w/${projectId}/settings`);
  await expect(
    page.getByRole("heading", { name: "Navigation Project" }),
  ).toBeVisible();

  await page.goBack();

  await expect(page).toHaveURL(documentPath);
  await expect(page.getByLabel("Note title")).toHaveValue(
    "Welcome to Floe Note",
  );

  await page.goForward();
  await expect(page).toHaveURL(`/w/${projectId}/settings`);
  await page.goBack();
  await expect(page).toHaveURL(documentPath);

  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page).toHaveURL("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.goBack();

  await expect(page).toHaveURL(documentPath);
  await expect(page.getByLabel("Note title")).toHaveValue(
    "Welcome to Floe Note",
  );
});

test("resolves root and reopens a canonical note URL after Vault unlock", async ({
  page,
}) => {
  const { projectId, documentId } = await createSecuredProject(page);
  const notePath = `/w/${projectId}/n/${documentId}`;

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Unlock Floe Note" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page).toHaveURL(notePath);
  await expect(page.getByLabel("Note title")).toHaveValue(
    "Welcome to Floe Note",
  );

  await page.goto(notePath);
  await expect(
    page.getByRole("heading", { name: "Unlock Floe Note" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page).toHaveURL(notePath);
  await expect(page.getByLabel("Note title")).toHaveValue(
    "Welcome to Floe Note",
  );
});

test("navigates Trash and a deleted note with Back and Forward", async ({
  page,
}) => {
  const { projectId, documentId } = await createSecuredProject(page);
  const notePath = `/w/${projectId}/n/${documentId}`;
  const trashPath = `/w/${projectId}/trash`;
  const trashNotePath = `${trashPath}/${documentId}`;

  await page.getByRole("button", { name: "New note" }).click();
  await page
    .getByRole("navigation", { name: "Notes" })
    .getByRole("button", { name: "Welcome to Floe Note" })
    .click();
  await expect(page).toHaveURL(notePath);

  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page).toHaveURL(trashPath);
  await page.getByRole("heading", { name: "Trash" }).waitFor();
  await page
    .getByRole("button", { name: "Welcome to Floe Note" })
    .last()
    .click();
  await expect(page).toHaveURL(trashNotePath);

  await page.goBack();
  await expect(page).toHaveURL(trashPath);
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(trashNotePath);
});
