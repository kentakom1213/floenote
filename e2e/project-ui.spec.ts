import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

async function createProject(page: import("@playwright/test").Page, name: string) {
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "New / Import Project…" }).click();
  await page.getByRole("button", { name: "Blank Project" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Create Project" }).click();
  await expect(page.getByLabel(`Switch Project, current ${name}`)).toBeVisible();
}

async function openSelectedProjectSettings(page: import("@playwright/test").Page) {
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Project settings…" }).click();
}

async function archiveProjectFromSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Archive Project…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive Project" }).click();
}

test("scopes notes, creates in the selected Project, and reconciles URLs, history and global search", async ({ page }) => {
  const { projectId, documentId } = await createSecuredProject(page);
  const notesUrl = `/w/${projectId}/n/${documentId}`;
  await createProject(page, "Research");

  await expect(page).toHaveURL(`/w/${projectId}`);
  await expect(page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "Welcome to Floe Note" })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page).toHaveURL(`/w/${projectId}`);
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page).toHaveURL(`/w/${projectId}`);
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();
  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Note title").fill("Research note");
  const researchUrl = new URL(page.url()).pathname;
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();
  await page.getByLabel(/Switch Project, current/).click();
  await expect(page.getByRole("button", { name: "Rename Project…" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Archive Project…" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New / Import Project…" }).locator("svg")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Archived projects…" }).locator("svg")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Manage Project…" })).toHaveCount(0);
  await page.getByRole("button", { name: "Project settings…" }).click();
  await expect(page.getByRole("button", { name: "Archive Project…" })).toBeDisabled();
  await page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "Research note" }).click();
  await page.getByRole("button", { name: "Search notes", exact: true }).click();
  await page.getByRole("searchbox", { name: "Filter notes by title or tag" }).fill("Welcome");
  await expect(page.getByText("No matching notes")).toBeVisible();
  await page.getByRole("button", { name: "Search notes", exact: true }).click();

  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page).toHaveURL(notesUrl);
  await expect(page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "Research note" })).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(researchUrl);
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(notesUrl);
  await expect(page.getByLabel("Switch Project, current Notes")).toBeVisible();

  await page.getByRole("button", { name: "Search all notes" }).click();
  await page.getByRole("searchbox", { name: "Search all notes" }).fill("Research note");
  await page.getByRole("option", { name: /Research note/ }).click();
  await expect(page).toHaveURL(researchUrl);
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();

  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Move note…" }).click();
  await expect(page.getByRole("dialog", { name: "Move note…" }).getByRole("button", { name: "Notes" })).toBeVisible();
  await page.getByRole("dialog", { name: "Move note…" }).getByRole("button", { name: "Notes" }).click();
  await expect(page).toHaveURL(researchUrl);
  await expect(page.getByLabel("Switch Project, current Notes")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "Research note" })).toBeVisible();

  await page.goto(researchUrl);
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page.getByLabel("Switch Project, current Notes")).toBeVisible();

  await page.getByLabel("Actions for Research note").click();
  await page.locator(".note-row-menu[open]").getByRole("button", { name: "Move note…" }).click();
  await page.getByRole("dialog", { name: "Move note…" }).getByRole("button", { name: "Research" }).click();
  await expect(page).toHaveURL(researchUrl);
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();

  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await openSelectedProjectSettings(page);
  await archiveProjectFromSettings(page);
  await expect(page.getByLabel("Switch Project, current Notes")).toBeVisible();
  await page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "Welcome to Floe Note" }).click();
  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Move note…" }).click();
  await expect(page.getByRole("dialog", { name: "Move note…" }).getByRole("button", { name: "Research" })).toHaveCount(0);
});

test("renames, archives, reopens and persists zero active Projects", async ({ page }) => {
  const { projectId } = await createSecuredProject(page);
  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page).toHaveURL(`/w/${projectId}`);

  await openSelectedProjectSettings(page);
  await page.getByLabel("Project name").fill("Scratch");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Scratch" })).toBeVisible();
  await expect(page.getByLabel("Switch Project, current Scratch")).toBeVisible();

  await archiveProjectFromSettings(page);
  await expect(page).toHaveURL(`/w/${projectId}/settings`);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "No active Projects" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New note" })).toBeDisabled();
  await expect(page.getByLabel("Switch Project, current None")).toBeVisible();
  await expect(page.getByRole("button", { name: "New / Import Project", exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page.getByRole("heading", { name: "No active Projects" })).toBeVisible();
  await page.getByRole("button", { name: "Reopen archived Project" }).click();
  await page.getByRole("dialog", { name: "Archived projects" }).getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByLabel("Switch Project, current Scratch")).toBeVisible();

  await openSelectedProjectSettings(page);
  await archiveProjectFromSettings(page);

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("button", { name: "Welcome to Floe Note" }).last().click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByLabel("Switch Project, current Scratch")).toBeVisible();
});

test("creates a Project from the zero-active empty state", async ({ page }) => {
  await createSecuredProject(page);
  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await openSelectedProjectSettings(page);
  await archiveProjectFromSettings(page);
  await page.goBack();
  await page.getByRole("button", { name: "New / Import Project", exact: true }).click();
  await page.getByRole("button", { name: "Blank Project" }).click();
  await page.getByLabel("Project name").fill("Fresh start");
  await page.getByRole("dialog").getByRole("button", { name: "Create Project" }).click();
  await expect(page.getByLabel("Switch Project, current Fresh start")).toBeVisible();
  await expect(page.getByRole("button", { name: "New note" })).toBeEnabled();
});

test("exports one Project and imports it into the existing Workspace", async ({ page }) => {
  const { projectId, documentId } = await createSecuredProject(page);
  const importedBody = "# Imported body\n\nUnique imported editor text";
  const editor = page.locator('.editor [contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill(importedBody);
  await expect(editor).toContainText("Unique imported editor text");

  await openSelectedProjectSettings(page);
  const settingsUrl = new URL(page.url()).pathname;
  await page.getByLabel("Project name").fill("Research");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(settingsUrl);

  await expect(page.locator(".settings-view")).toContainText("readable Markdown");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Project", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Research.floe.zip");
  const archivePath = await download.path();
  if (!archivePath) throw new Error("Export download is unavailable");
  const archive = await readFile(archivePath);
  await page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "Welcome to Floe Note" }).click();
  await expect(page).toHaveURL(`/w/${projectId}/n/${documentId}`);
  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await openSelectedProjectSettings(page);
  await archiveProjectFromSettings(page);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "No active Projects" })).toBeVisible();

  const workspaceCommits: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/security\/transitions$/.test(request.url())) {
      workspaceCommits.push(request.url());
    }
  });
  await page.getByRole("button", { name: "New / Import Project", exact: true }).click();
  const projectCreation = page.getByRole("dialog", { name: "New / Import Project" });
  await expect(projectCreation.getByRole("button", { name: "Blank Project" }).locator("svg")).toHaveCount(1);
  await expect(projectCreation.getByRole("button", { name: /Import…/ }).locator("svg")).toHaveCount(1);
  await expect(projectCreation.getByRole("button", { name: "Import Floe export" })).toHaveCount(0);
  await projectCreation.getByRole("button", { name: /Import…/ }).click();
  const importChoices = page.getByRole("dialog", { name: "Import Project" });
  await expect(importChoices.getByRole("button", { name: "Import Floe export" }).locator("svg")).toHaveCount(1);
  await expect(importChoices.getByRole("button", { name: "Import Markdown directory" }).locator("svg")).toHaveCount(1);
  await importChoices.getByRole("button", { name: "Back" }).click();
  await expect(projectCreation).toBeVisible();
  await projectCreation.getByRole("button", { name: /Import…/ }).click();
  await page.getByRole("button", { name: "Import Floe export" }).click();
  const projectImport = page.getByRole("dialog", { name: "Import Floe export" });
  const projectFileInput = projectImport.locator('input[type="file"]');
  await projectFileInput.setInputFiles({ name: "invalid.floe.zip", mimeType: "application/zip", buffer: Buffer.from([1, 2, 3]) });
  await expect(projectImport.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Switch Project, current None")).toBeVisible();
  await projectFileInput.setInputFiles({ name: "Research.floe.zip", mimeType: "application/zip", buffer: archive });
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();
  await expect(page.getByLabel("Note title")).toHaveValue("Welcome to Floe Note");
  await expect(page.locator('.editor [contenteditable="true"]')).toContainText(
    "Unique imported editor text",
  );
  await expect(page).toHaveURL(new RegExp(`^.*/w/${projectId}/n/[^/]+$`));
  expect(new URL(page.url()).pathname).not.toBe(`/w/${projectId}/n/${documentId}`);
  expect(workspaceCommits).toHaveLength(0);

  await page.reload();
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();
  await expect(page.getByLabel("Note title")).toHaveValue("Welcome to Floe Note");
  await expect(page.locator('.editor [contenteditable="true"]')).toContainText(
    "Unique imported editor text",
  );

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Workspace" }).click();
  await expect(page.getByText("Export notes")).toHaveCount(0);

});

test("imports a Markdown directory as one Project in the existing Workspace", async ({ page }) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "floe-project-import-"));
  const directory = join(temporaryDirectory, "research");
  await mkdir(join(directory, "papers"), { recursive: true });
  await writeFile(join(directory, "inbox.md"), "---\nfrontmatter\n---\n");
  await writeFile(join(directory, "papers", "paper-a.markdown"), "# Paper\n");
  await writeFile(join(directory, ".hidden.md"), "ignored");

  try {
    const { projectId } = await createSecuredProject(page);
    await page.getByLabel(/Switch Project, current/).click();
    await page.getByRole("button", { name: "New / Import Project…" }).click();
    await page.getByRole("button", { name: /Import…/ }).click();
    await page.getByRole("button", { name: "Import Markdown directory" }).click();
    await page.getByRole("dialog", { name: "Import Markdown directory" }).locator('input[type="file"]').setInputFiles(directory);
    await expect(page.getByLabel("Switch Project, current research")).toBeVisible();
    await expect(page.getByLabel("Note title")).toHaveValue("inbox");
    await expect(page).toHaveURL(new RegExp(`^.*/w/${projectId}/n/[^/]+$`));
    await expect(page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "paper-a" })).toBeVisible();

  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("keeps long Project names inside the selector and archive list", async ({ page }) => {
  await createSecuredProject(page);
  const heights = await page.evaluate(() => {
    const height = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect().height;
    return [
      height(".project-switcher-trigger"),
      height(".global-search-trigger"),
      height(".sidebar-collapse-button"),
    ];
  });
  expect(heights).toEqual([30, 30, 30]);
  await expect(page.locator(".project-switcher-chevron")).toHaveCount(0);

  const longName = `Research-${"x".repeat(180)}`;
  await createProject(page, longName);
  const triggerFits = await page.locator(".workspace-project-trigger").evaluate((trigger) => {
    const control = trigger.closest(".workspace-project-control")!;
    const [name, chevron] = trigger.querySelectorAll("span");
    return (
      trigger.getBoundingClientRect().right <= control.getBoundingClientRect().right &&
      name!.getBoundingClientRect().right <= chevron!.getBoundingClientRect().left
    );
  });
  expect(triggerFits).toBe(true);

  await page.getByLabel(/Switch Project, current/).click();
  const itemFits = await page.locator('.workspace-project-menu-item[aria-current="true"]').evaluate((item) => {
    const label = item.querySelector("span")!;
    return label.getBoundingClientRect().right <= item.getBoundingClientRect().right;
  });
  expect(itemFits).toBe(true);
  await page.getByRole("button", { name: "Project settings…" }).click();
  await page.getByRole("button", { name: "Archive Project…" }).click();
  const archiveDialog = page.getByRole("dialog");
  const titleFits = await archiveDialog.evaluate((dialog) => {
    const title = dialog.querySelector("h2")!;
    return (
      title.getBoundingClientRect().left >= dialog.getBoundingClientRect().left &&
      title.getBoundingClientRect().right <= dialog.getBoundingClientRect().right
    );
  });
  expect(titleFits).toBe(true);
  await archiveDialog.getByRole("button", { name: "Archive Project" }).click();

  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Archived projects…" }).click();
  const row = page.locator(".archived-project-row");
  const archiveFits = await row.evaluate((element) => {
    const name = element.querySelector("span")!;
    const button = element.querySelector("button")!;
    return name.getBoundingClientRect().right <= button.getBoundingClientRect().left;
  });
  expect(archiveFits).toBe(true);
  await expect(row.getByRole("button", { name: "Reopen" })).toHaveCSS("border-top-style", "solid");
});

test("shows Project settings within the mobile viewport and saves its name", async ({ page }) => {
  await createSecuredProject(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Project settings…" }).click();
  await expect(page.locator(".settings-view")).toBeVisible();
  const rightEdge = await page.locator(".settings-view").evaluate((view) => view.getBoundingClientRect().right);
  expect(rightEdge).toBeLessThanOrEqual(390);

  await page.getByLabel("Project name").fill("Mobile notes");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Mobile notes" })).toBeVisible();
  await expect(page.getByLabel("Switch Project, current Mobile notes")).toBeVisible();
});
