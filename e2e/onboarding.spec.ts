import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("starts writing in a default Workspace without naming it", async ({ page }) => {
  await createSecuredProject(page);
  await expect(page.locator(".brand-row")).toContainText("Personal");
});

test("keeps portable and Markdown imports reachable on first run", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".onboarding-entry")).not.toContainText("Project");
  await page.getByRole("button", { name: /Import Floe export/ }).click();
  await expect(page.getByRole("heading", { name: "Secure this device" })).toBeVisible();
  await page.getByLabel("Device name").fill("Import test device");
  await page.getByRole("button", { name: "Create new passkey" }).click();
  await expect(page.getByRole("heading", { name: "Import Floe export" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: /Import Markdown directory/ }).click();
  await expect(page.getByRole("heading", { name: "Import Markdown directory" })).toBeVisible();
});
