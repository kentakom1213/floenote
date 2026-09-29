import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

async function createProject(page: import("@playwright/test").Page, name: string) {
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "New / Import Project…" }).click();
  await page.getByRole("button", { name: "Blank Project" }).click();
  const dialog = page.getByRole("dialog", { name: "Blank Project" });
  await dialog.getByLabel("Project name").fill(name);
  await dialog.getByRole("button", { name: "Create Project" }).click();
}

async function openProjectSettings(page: import("@playwright/test").Page) {
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Project settings…" }).click();
  return new URL(page.url()).pathname;
}

test("keeps Project settings URL-derived and traverses Settings scopes with history", async ({ page }) => {
  const { projectId: workspaceId, documentId } = await createSecuredProject(page);
  const notesUrl = `/w/${workspaceId}/n/${documentId}`;
  const notesSettingsUrl = await openProjectSettings(page);
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await createProject(page, "Research");
  const researchSettingsUrl = await openProjectSettings(page);
  expect(researchSettingsUrl).not.toBe(notesSettingsUrl);
  await expect(page.getByRole("heading", { name: "Research" })).toBeVisible();

  await page.goto(notesSettingsUrl);
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page).toHaveURL(notesSettingsUrl);
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Project", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("Notes.floe.zip");

  const scopes = page.getByRole("navigation", { name: "Settings sections" });
  await scopes.getByRole("button", { name: "General" }).click();
  await expect(page).toHaveURL("/settings");
  await scopes.getByRole("button", { name: "Workspace" }).click();
  await expect(page).toHaveURL(`/w/${workspaceId}/settings`);
  await scopes.getByText("Projects: Research").click();
  await scopes.getByRole("button", { name: "Research" }).click();
  await expect(page).toHaveURL(researchSettingsUrl);
  await scopes.getByText("Projects: Research").click();
  await scopes.getByRole("button", { name: "Notes" }).click();
  await expect(page).toHaveURL(notesSettingsUrl);
  await page.goBack();
  await expect(page).toHaveURL(researchSettingsUrl);
  await page.goBack();
  await expect(page).toHaveURL(`/w/${workspaceId}/settings`);
  await page.goBack();
  await expect(page).toHaveURL("/settings");
  await page.goForward();
  await page.goForward();
  await expect(page).toHaveURL(researchSettingsUrl);
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();

  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page).toHaveURL(notesUrl);
});

test("archives empty Projects, rejects archived settings URLs, and handles zero active Projects", async ({ page }) => {
  const { projectId: workspaceId } = await createSecuredProject(page);
  await createProject(page, "Research");
  const researchSettingsUrl = await openProjectSettings(page);
  await page.getByRole("button", { name: "Archive Project…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive Project" }).click();
  await expect(page).toHaveURL(`/w/${workspaceId}/settings`);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`^.*\/w\/${workspaceId}\/n\/[^/]+$`));
  await page.goForward();
  await expect(page).toHaveURL(`/w/${workspaceId}/settings`);
  const scopes = page.getByRole("navigation", { name: "Settings sections" });
  await scopes.getByText("Projects: Notes").click();
  await expect(scopes.getByRole("button", { name: "Research" })).toHaveCount(0);
  await scopes.getByRole("button", { name: "Notes" }).click();
  const notesSettingsUrl = new URL(page.url()).pathname;

  await page.goto(researchSettingsUrl);
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page).toHaveURL(`/w/${workspaceId}/settings`);

  await page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "Welcome to Floe Note" }).click();
  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "Welcome to Floe Note" })).toHaveCount(0);
  await openProjectSettings(page);
  await expect(page).toHaveURL(notesSettingsUrl);
  await page.getByRole("button", { name: "Archive Project…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive Project" }).click();
  await expect(page).toHaveURL(`/w/${workspaceId}/settings`);
  await expect(page.getByRole("navigation", { name: "Settings sections" }).locator(".settings-project-selector")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "General" })).toBeVisible();

  const unavailableId = notesSettingsUrl.slice(-1) === "0" ? `${notesSettingsUrl.slice(0, -1)}1` : `${notesSettingsUrl.slice(0, -1)}0`;
  await page.goto(unavailableId);
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page).toHaveURL(`/w/${workspaceId}/settings`);
});

test("opens Workspace settings from its selector and exits Settings when switching Workspaces", async ({ page }) => {
  const { projectId: firstWorkspaceId } = await createSecuredProject(page);
  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: "Workspace settings…" }).click();
  await expect(page).toHaveURL(`/w/${firstWorkspaceId}/settings`);
  await expect(page.getByLabel("Workspace name")).toHaveValue("Personal");

  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: "New workspace" }).click();
  await page.getByRole("button", { name: /Blank workspace/ }).click();
  await page.getByRole("dialog", { name: "New workspace" }).getByRole("textbox", { name: "Name", exact: true }).fill("Other workspace");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.locator(".brand-row")).toContainText("Other workspace");
  const secondWorkspaceId = new URL(page.url()).pathname.split("/")[2];
  expect(secondWorkspaceId).not.toBe(firstWorkspaceId);

  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: "Workspace settings…" }).click();
  await expect(page).toHaveURL(`/w/${secondWorkspaceId}/settings`);
  await page.getByLabel("Switch workspace").click();
  await page.getByRole("button", { name: "Personal" }).click();
  await expect(page).toHaveURL(new RegExp(`^.*\/w\/${firstWorkspaceId}(?:\/n\/[^/]+)?$`));
  await expect(page.getByLabel("Workspace name")).toHaveCount(0);
});

test("keeps duplicate and long Project names usable in mobile Settings navigation", async ({ page }) => {
  await createSecuredProject(page);
  const name = `Research ${"long-name-".repeat(8)}`;
  await createProject(page, name);
  const firstUrl = await openProjectSettings(page);
  await createProject(page, name);
  const secondUrl = await openProjectSettings(page);
  expect(firstUrl).not.toBe(secondUrl);

  await page.setViewportSize({ width: 390, height: 844 });
  const scopes = page.getByRole("navigation", { name: "Settings sections" });
  const summary = scopes.locator(".settings-project-selector summary");
  const summaryFits = await summary.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth);
  expect(summaryFits).toBe(true);
  await summary.click();
  const choices = scopes.getByRole("button", { name });
  await expect(choices).toHaveCount(2);
  const menuFits = await scopes.locator(".settings-project-menu").evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth);
  expect(menuFits).toBe(true);
  await choices.first().click();
  await expect(page).toHaveURL(firstUrl);
  await expect(summary).toContainText(name);
});
