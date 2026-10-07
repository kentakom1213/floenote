import { createPortableProjectExport } from "@floe-note/document";

import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("introduces the local-first concept and prioritizes a new passkey on first run", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Local-first notes, across your devices",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Write locally, sync directly between your devices, or bring in notes you already have.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Start writing" }).click();

  const createPasskey = page.getByRole("button", {
    name: "Create new passkey",
  });
  const syncedPasskey = page.getByRole("button", {
    name: "Use a synced passkey",
  });

  await expect(createPasskey).toHaveClass("unlock-primary-action");
  await expect(syncedPasskey).toHaveClass("unlock-secondary-action");
  await expect(page.getByText("Shown on your other devices.")).toBeVisible();
});

test("starts writing in a default Workspace without naming it", async ({ page }) => {
  await createSecuredProject(page);
  await expect(page.locator(".brand-row")).toContainText("Personal");
});

test("keeps portable and Markdown imports reachable on first run", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".onboarding-entry")).toContainText("Personal Workspace with the imported Project");
  await page.getByRole("button", { name: /Import Floe export/ }).click();
  await expect(page.getByRole("heading", { name: "Secure this device" })).toBeVisible();
  await page.getByLabel("Device name").fill("Import test device");
  await page.getByRole("button", { name: "Create new passkey" }).click();
  await expect(page.getByRole("heading", { name: "Import Floe export" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: /Import Markdown directory/ }).click();
  await expect(page.getByRole("heading", { name: "Import Markdown directory" })).toBeVisible();
});

test("starts with only the imported Project when onboarding from a Floe archive", async ({ page }) => {
  const archive = createPortableProjectExport(
    {
      name: "Research",
      documents: [{
        title: "From archive",
        body: "# Imported\n",
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        tags: ["research"],
      }],
    },
    { exportedAt: 1_700_000_000_000 },
  ).archive;

  await page.goto("/");
  await page.getByRole("button", { name: /Import Floe export/ }).click();
  await page.getByLabel("Device name").fill("Import test device");
  await page.getByRole("button", { name: "Create new passkey" }).click();
  const commitPromise = page.waitForResponse((response) =>
    /\/workspaces\/[^/]+\/security\/transitions$/.test(response.url()) && response.request().method() === "POST",
  );
  await page.getByRole("dialog", { name: "Import Floe export" }).locator('input[type="file"]').setInputFiles({
    name: "Research.floe.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });

  expect((await commitPromise).status()).toBe(201);
  await expect(page.locator(".brand-row")).toContainText("Personal");
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();
  await expect(page.getByLabel("Note title")).toHaveValue("From archive");
  await expect(page).toHaveURL(/\/w\/[^/]+\/n\/[^/]+$/);
  await page.getByLabel(/Switch Project, current/).click();
  await expect(page.getByRole("button", { name: "Notes", exact: true })).toHaveCount(0);
});
