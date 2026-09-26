import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("keeps visible views and browser history aligned", async ({ page }) => {
  const { projectId, documentId } = await createSecuredProject(
    page,
    "Navigation Project",
  );
  const documentPath = `/p/${projectId}/${documentId}`;

  await page.getByLabel("Switch project").click();
  await page.getByRole("button", { name: "Project settings" }).click();

  await expect(page).toHaveURL(`/p/${projectId}/settings`);
  await expect(
    page.getByRole("heading", { name: "Navigation Project" }),
  ).toBeVisible();

  await page.goBack();

  await expect(page).toHaveURL(documentPath);
  await expect(page.getByLabel("Note title")).toHaveValue(
    "Welcome to Floe Note",
  );

  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page).toHaveURL("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.goBack();

  await expect(page).toHaveURL(documentPath);
  await expect(page.getByLabel("Note title")).toHaveValue(
    "Welcome to Floe Note",
  );
});
