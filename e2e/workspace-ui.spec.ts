import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("keeps Workspace switching and creation in the compact sidebar context", async ({
  page,
}) => {
  const { projectId, documentId } = await createSecuredProject(page);
  await expect(page.locator(".brand-row")).toContainText("Personal");
  await expect(page.locator(".project-slot")).toHaveCount(0);
  await expect(page.getByLabel("Switch Project, current Notes")).toBeVisible();
  await expect(page.locator(".sidebar-section-label")).toHaveText("Notes");

  await page.getByLabel("Switch workspace").click();
  await expect(page.getByRole("button", { name: "New workspace" })).toBeVisible();
  await page.getByRole("button", { name: "New workspace" }).click();
  await expect(page.getByRole("button", { name: /Blank workspace/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Import Floe export/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Import Markdown directory/ })).toBeVisible();

  await page.getByRole("button", { name: /Blank workspace/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Research");
  const commit = page.waitForResponse((response) =>
    /\/workspaces\/[^/]+\/security\/transitions$/.test(response.url()) &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create workspace" }).click();
  expect((await commit).status()).toBe(201);
  await expect(page.locator(".brand-row")).toContainText("Research");

  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page
    .getByRole("button", { name: "Welcome to Floe Note" })
    .last()
    .click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/trash\/[0-9a-f-]+$/);

  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: "Personal" }).click();
  await expect(page).toHaveURL(`/w/${projectId}/n/${documentId}`);
  await expect(page.getByLabel("Note title")).toHaveValue("Welcome to Floe Note");
  await expect(page.getByRole("heading", { name: "Trash" })).toHaveCount(0);
});

test("keeps device shortcuts and detailed management in Settings", async ({
  page,
}) => {
  const { projectId, documentId } = await createSecuredProject(page);
  const notePath = `/w/${projectId}/n/${documentId}`;

  await page.locator(".sync-status-summary").click();
  await expect(page.locator(".sync-status-heading")).toContainText("Devices");
  await expect(page.locator(".sync-device-list")).toContainText("Playwright Chromium");
  await expect(page.getByRole("button", { name: "Add device" })).toBeEnabled();
  await page.getByRole("button", { name: "Add device" }).click();
  await expect(page.getByRole("heading", { name: "Add a device" })).toBeVisible();
  await expect(page).toHaveURL(notePath);
  await page.getByRole("button", { name: "Cancel invitation" }).click();
  await expect(page).toHaveURL(notePath);
  await expect(page.getByLabel("Note title")).toHaveValue(
    "Welcome to Floe Note",
  );

  await page.locator(".sync-status-summary").click();
  await page.getByRole("button", { name: /Manage devices/ }).click();

  await expect(page).toHaveURL(`/w/${projectId}/settings`);
  await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add device" })).toBeVisible();
  await expect(page.getByLabel("Workspace name")).toHaveValue("Personal");
  await expect(page.locator(".settings-view")).not.toContainText("Project");
  await page.getByRole("button", { name: "Add device" }).click();
  await expect(page.getByRole("heading", { name: "Add a device" })).toBeVisible();
  await expect(page).toHaveURL(`/w/${projectId}/settings`);
  await page.getByRole("button", { name: "Cancel invitation" }).click();
  await expect(page).toHaveURL(`/w/${projectId}/settings`);
  await expect(page.getByLabel("Workspace name")).toHaveValue("Personal");

  const settingsSections = page.getByRole("navigation", {
    name: "Settings sections",
  });
  await expect(
    settingsSections.getByRole("button", { name: "General" }),
  ).toBeVisible();
  await expect(
    settingsSections.getByRole("button", { name: "Workspace" }),
  ).toBeVisible();
  await expect(
    settingsSections.getByRole("button", { name: "Personal" }),
  ).toHaveCount(0);
  await settingsSections.getByRole("button", { name: "General" }).click();
  await expect(page).toHaveURL("/settings");
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This device" })).toBeVisible();
  await expect(page.locator(".settings-view")).not.toContainText("Project");
  await expect(
    settingsSections.getByRole("button", { name: "Workspace" }),
  ).toBeVisible();
});

test("removes only the selected Workspace from this device", async ({
  page,
}) => {
  const { projectId, documentId } = await createSecuredProject(page);
  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: "New workspace" }).click();
  await page.getByRole("button", { name: /Blank workspace/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Temporary");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.locator(".brand-row")).toContainText("Temporary");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const deviceIdBefore = await page.locator(".settings-section")
    .filter({ has: page.getByRole("heading", { name: "This device" }) })
    .locator("dd").first().textContent();
  expect(deviceIdBefore).toBeTruthy();
  await page.getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("heading", {
    name: "Remove Temporary from this device?",
  })).toBeVisible();
  await page.getByRole("button", { name: "Remove from this device" }).click();

  await expect(page).toHaveURL(`/w/${projectId}/n/${documentId}`);
  await expect(page.getByLabel("Note title")).toHaveValue("Welcome to Floe Note");
  await page.getByLabel("Switch workspace").click();
  await expect(page.getByRole("button", { name: "Personal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Temporary" })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const deviceIdAfter = await page.locator(".settings-section")
    .filter({ has: page.getByRole("heading", { name: "This device" }) })
    .locator("dd").first().textContent();
  expect(deviceIdAfter).toBe(deviceIdBefore);
});
