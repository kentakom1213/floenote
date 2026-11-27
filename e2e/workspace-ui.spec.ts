import { createPortableWorkspaceExport } from "@floe-note/document";
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
  await expect(page.getByRole("button", { name: "Workspace settings…" })).toBeVisible();
  await expect(page.getByRole("button", { name: /New \/ Import Workspace/ })).toBeVisible();
  const actionLabels = page.locator(".project-switcher-action > span:last-child");
  for (const label of await actionLabels.all()) {
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await expect(page.locator(".project-switcher-action")).toHaveText([
    "＋New / Import Workspace…",
    "⚙Workspace settings…",
  ]);
  await page.getByRole("button", { name: /New \/ Import Workspace/ }).click();
  const newWorkspaceDialog = page.getByRole("dialog", { name: /New \/ Import Workspace/ });
  const createWorkspace = newWorkspaceDialog.getByRole("button", {
    name: /Create new workspace/,
  });
  const joinWorkspace = newWorkspaceDialog.getByRole("button", {
    name: /Join with invitation link/,
  });
  await expect(newWorkspaceDialog.getByRole("button", { name: /Import Workspace/ })).toBeVisible();
  await expect(createWorkspace).toBeVisible();
  await expect(createWorkspace.locator("svg")).toHaveCount(1);
  await expect(joinWorkspace).toBeVisible();
  await expect(joinWorkspace.locator("svg")).toHaveCount(1);
  await expect(
    newWorkspaceDialog.getByRole("button", { name: /Import Floe export/ }),
  ).toHaveCount(0);
  await expect(
    newWorkspaceDialog.getByRole("button", { name: /Import Markdown directory/ }),
  ).toHaveCount(0);

  await createWorkspace.click();
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
  const deletedNoteActions = page.getByLabel("Actions for Welcome to Floe Note");
  await expect(deletedNoteActions).toHaveCSS("border-top-width", "0px");
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: "Research" }).click();
  await expect(page.locator(".brand-row")).toContainText("Research");
  await expect(page.locator(".sidebar")).toHaveAttribute("data-mobile-open", "true");

  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: "Personal" }).click();
  await expect(page.locator(".brand-row")).toContainText("Personal");
  await expect(page.locator(".sidebar")).toHaveAttribute("data-mobile-open", "true");
});

test("keeps the mobile sidebar open behind the New workspace dialog", async ({
  page,
}) => {
  await createSecuredProject(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: /New \/ Import Workspace/ }).click();

  await expect(page.locator(".sidebar")).toHaveAttribute("data-mobile-open", "true");
  await expect(page.getByRole("dialog", { name: /New \/ Import Workspace/ })).toBeVisible();
  expect(await page.locator(".dialog-backdrop").evaluate(
    (backdrop) => backdrop.parentElement === document.body,
  )).toBe(true);
  expect((await page.locator(".dialog-backdrop").boundingBox())?.width).toBe(390);

  await page.getByRole("button", { name: /Create new workspace/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Mobile workspace");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("dialog", { name: /New \/ Import Workspace/ })).toHaveCount(0);
  await expect(page.locator(".brand-row")).toContainText("Mobile workspace");
  await expect(page.locator(".sidebar")).toHaveAttribute("data-mobile-open", "true");
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
  await expect(page.getByLabel("Project name")).toHaveCount(0);
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
  await expect(page.getByLabel("Project name")).toHaveCount(0);
  await expect(
    settingsSections.getByRole("button", { name: "Workspace" }),
  ).toBeVisible();
});

test("shows Offline while the browser has no network and recovers without reload", async ({
  page,
  context,
}) => {
  await createSecuredProject(page);
  const status = page.locator(".sync-status-summary");

  await context.setOffline(true);
  await expect(status).toContainText("Offline");

  await context.setOffline(false);
  await expect(status).not.toContainText("Offline");
});

test("removes only the selected Workspace from this device", async ({
  page,
}) => {
  const { projectId, documentId } = await createSecuredProject(page);
  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: /New \/ Import Workspace/ }).click();
  await page.getByRole("button", { name: /Create new workspace/ }).click();
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

test("imports an exported Workspace without changing the current Workspace", async ({ page }) => {
  const { projectId, documentId } = await createSecuredProject(page);
  const archive = createPortableWorkspaceExport({
    name: "Restored",
    projects: [
      { name: "Research", documents: [{ title: "Imported note", body: "# Restored", createdAt: 100, updatedAt: 200, tags: ["test"] }] },
      { name: "Empty", documents: [] },
    ],
  }).archive;
  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: /New \/ Import Workspace/ }).click();
  await page.getByRole("button", { name: /Import Workspace/ }).click();
  const dialog = page.getByRole("dialog", { name: "Import Workspace" });
  await dialog.getByLabel("Workspace ZIP").setInputFiles({
    name: "Restored.floe-workspace.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });
  await expect(dialog).toContainText("Restored");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".brand-row")).toContainText("Restored");
  await page.getByLabel("Switch Project").click();
  await expect(page.getByRole("button", { name: "Research", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Empty", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("Imported note");
  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: "Personal" }).click();
  await expect(page).toHaveURL(`/w/${projectId}/n/${documentId}`);
});
