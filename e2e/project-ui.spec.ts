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

async function splitOrientation(
  page: import("@playwright/test").Page,
): Promise<"horizontal" | "vertical" | "other"> {
  return page.locator(".editor-view-split").evaluate((view) => {
    const source = view.querySelector(".editor-view-source");
    const preview = view.querySelector(".editor-view-preview");
    if (!source || !preview) return "other";

    const sourceRect = source.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const tolerance = 2;

    if (
      Math.abs(sourceRect.top - previewRect.top) <= tolerance &&
      previewRect.left >= sourceRect.right - tolerance
    ) {
      return "horizontal";
    }

    if (
      Math.abs(sourceRect.left - previewRect.left) <= tolerance &&
      previewRect.top >= sourceRect.bottom - tolerance
    ) {
      return "vertical";
    }

    return "other";
  });
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
  await expect(page.locator('.editor [contenteditable="true"]')).toBeFocused();

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

test("renames a Project tag and searches Notes by Project context", async ({ page }) => {
  await createSecuredProject(page);
  await createProject(page, "Research");
  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Note title").fill("Graph notes");
  await page.getByRole("button", { name: "Add tag" }).click();
  await page.getByRole("combobox", { name: "Add tag" }).fill("todo");
  await page.getByRole("combobox", { name: "Add tag" }).press("Enter");
  await expect(page.getByLabel("Change todo color")).toBeVisible();
  await page.getByLabel("Change todo color").click();
  await page.getByRole("textbox", { name: "Rename todo" }).fill("papers");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByLabel("Change papers color")).toBeVisible();

  await page.getByLabel("Filter notes by tags").click();
  await page.getByRole("checkbox", { name: "papers" }).check();
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Switch Project, current Notes")).toBeVisible();
  await page.getByLabel("Filter notes by tags").click();
  await expect(page.getByRole("checkbox", { name: "papers" })).toHaveCount(0);

  await page.getByRole("button", { name: "Search all notes" }).click();
  const search = page.getByRole("searchbox", { name: "Search all notes" });
  await search.fill("research graph");
  const result = page.getByRole("option", { name: /Graph notes/ });
  await expect(result).toContainText("Research");
  await result.click();
  await expect(page.getByLabel("Switch Project, current Research")).toBeVisible();
  await page.getByRole("button", { name: "Search all notes" }).click();
  await search.fill("papers");
  await expect(page.getByRole("option", { name: /Graph notes/ })).toBeVisible();
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

test("shows imported Project tags as assignment suggestions", async ({ page }) => {
  await createSecuredProject(page);

  await page.getByRole("button", { name: "Add tag" }).click();
  let tagInput = page.getByRole("combobox", { name: "Add tag" });
  await tagInput.fill("current-tag");
  await tagInput.press("Enter");

  await page.getByRole("button", { name: "New note" }).click();
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill("Suggestion source");
  await page.getByRole("button", { name: "Add tag" }).click();
  tagInput = page.getByRole("combobox", { name: "Add tag" });
  await tagInput.fill("imported-suggestion");
  await tagInput.press("Enter");

  await page
    .getByRole("navigation", { name: "Notes" })
    .getByRole("button", { name: "Welcome to Floe Note" })
    .click();

  await openSelectedProjectSettings(page);
  await page.getByLabel("Project name").fill("Tag source");
  await page.getByRole("button", { name: "Save" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Project", exact: true }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  if (!archivePath) throw new Error("Export download is unavailable");
  const archive = await readFile(archivePath);

  await page
    .getByRole("navigation", { name: "Notes" })
    .getByRole("button", { name: "Welcome to Floe Note" })
    .click();
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "New / Import Project…" }).click();
  await page.getByRole("button", { name: /Import…/ }).click();
  await page.getByRole("button", { name: "Import Floe export" }).click();
  await page
    .getByRole("dialog", { name: "Import Floe export" })
    .locator('input[type="file"]')
    .setInputFiles({
      name: "Tag source.floe.zip",
      mimeType: "application/zip",
      buffer: archive,
    });

  await expect(page.getByLabel("Switch Project, current Tag source")).toBeVisible();

  await page.getByRole("button", { name: "New note" }).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Untitled");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(
    page.getByRole("option").filter({ hasText: "current-tag" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option").filter({ hasText: "imported-suggestion" }),
  ).toBeVisible();
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
  await expect(page.locator(".workspace-project-chevron")).toHaveCount(1);
  const triggerFits = await page.locator(".workspace-project-trigger").evaluate((trigger) => {
    const control = trigger.closest(".workspace-project-control")!;
    const name = trigger.querySelector("span")!;
    const chevron = trigger.querySelector(".workspace-project-chevron")!;
    return (
      trigger.getBoundingClientRect().right <= control.getBoundingClientRect().right &&
      name.getBoundingClientRect().right <= chevron.getBoundingClientRect().left
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

test("adapts Split orientation to the available editor width", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await createSecuredProject(page);

  await page
    .getByLabel("Note view")
    .getByRole("button", { name: "Split" })
    .click();

  await expect
    .poll(() =>
      page.locator(".main-pane").evaluate((pane) => pane.getBoundingClientRect().width),
    )
    .toBeLessThan(960);
  await expect.poll(() => splitOrientation(page)).toBe("vertical");

  await page.getByRole("button", { name: "Hide sidebar" }).click();

  await expect
    .poll(() =>
      page.locator(".main-pane").evaluate((pane) => pane.getBoundingClientRect().width),
    )
    .toBeGreaterThanOrEqual(960);
  await expect.poll(() => splitOrientation(page)).toBe("horizontal");

  await page.setViewportSize({ width: 900, height: 800 });

  await expect
    .poll(() =>
      page.locator(".main-pane").evaluate((pane) => pane.getBoundingClientRect().width),
    )
    .toBeLessThan(960);
  await expect.poll(() => splitOrientation(page)).toBe("vertical");
});

test("uses Edit and Preview on narrow touch-only screens", async ({ page }) => {
  // Emulate connecting and disconnecting a trackpad without changing the viewport.
  await page.addInitScript(() => {
    const originalMatchMedia = window.matchMedia.bind(window);
    const events = new EventTarget();
    let finePointer = false;
    const finePointerQuery = {
      media: "(any-pointer: fine)",
      get matches() {
        return finePointer;
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    } as unknown as MediaQueryList;
    window.matchMedia = (query) =>
      query === finePointerQuery.media ? finePointerQuery : originalMatchMedia(query);
    Object.assign(window, {
      setFinePointerForTest(connected: boolean) {
        finePointer = connected;
        events.dispatchEvent(new Event("change"));
      },
    });
  });

  const setFinePointer = (connected: boolean) =>
    page.evaluate((value) => {
      (window as Window & { setFinePointerForTest: (connected: boolean) => void })
        .setFinePointerForTest(value);
    }, connected);

  await page.setViewportSize({ width: 1200, height: 800 });
  await createSecuredProject(page);

  const switcher = page.getByLabel("Note view");
  const currentView = page.locator(".document-current-view");
  await switcher.getByRole("button", { name: "Split" }).click();
  await expect(currentView).toHaveAttribute("data-editor-mode", "split");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(currentView).toHaveAttribute("data-editor-mode", "edit");
  await expect(switcher.getByRole("button", { name: "Split" })).toHaveCount(0);
  await expect(page.getByLabel("Note title")).toBeVisible();
  await expect(page.locator(".editor-view-source")).toBeVisible();
  await expect(page.locator(".editor-view-preview")).toHaveCount(0);

  const properties = page.getByLabel("Note properties");
  await properties.getByRole("button", { name: "Add tag" }).click();
  const input = properties.getByRole("combobox", { name: "Add tag" });
  await input.fill("mobile-tag");
  await input.press("Enter");
  await expect(properties.getByLabel("Change mobile-tag color")).toBeVisible();

  await setFinePointer(true);
  await expect(currentView).toHaveAttribute("data-editor-mode", "split");
  await expect(switcher.getByRole("button", { name: "Split" })).toBeVisible();
  await expect(page.locator(".editor-view-preview")).toBeVisible();

  await setFinePointer(false);
  await expect(currentView).toHaveAttribute("data-editor-mode", "edit");
  await expect(switcher.getByRole("button", { name: "Split" })).toHaveCount(0);

  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(currentView).toHaveAttribute("data-editor-mode", "split");

  await page.setViewportSize({ width: 390, height: 844 });
  await switcher.getByRole("button", { name: "Preview" }).click();
  await expect(currentView).toHaveAttribute("data-editor-mode", "preview");
  await expect(page.locator(".editor-view-source")).toHaveCount(0);
  await expect(page.locator(".editor-view-preview")).toBeVisible();

  await switcher.getByRole("button", { name: "Edit" }).click();
  await expect(currentView).toHaveAttribute("data-editor-mode", "edit");
  await expect(page.locator(".editor-view-source")).toBeVisible();
});

test("keeps Split usable in narrow windows with a fine pointer", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await createSecuredProject(page);

  expect(await page.evaluate(() => matchMedia("(any-pointer: fine)").matches)).toBe(true);

  const switcher = page.getByLabel("Note view");
  await expect(switcher.getByRole("button", { name: "Split" })).toBeVisible();
  await switcher.getByRole("button", { name: "Split" }).click();
  const currentView = page.locator(".document-current-view");
  await expect(currentView).toHaveAttribute("data-editor-mode", "split");

  const source = page.locator(".editor-view-source");
  const preview = page.locator(".editor-view-preview");
  await expect(source).toBeVisible();
  await expect(preview).toBeVisible();

  const layout = await currentView.evaluate((view) => {
    const editor = view.querySelector<HTMLElement>(".editor-view-split")!;
    const source = view.querySelector<HTMLElement>(".editor-view-source")!;
    const preview = view.querySelector<HTMLElement>(".editor-view-preview")!;
    const viewRect = view.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    return {
      withinViewport: editorRect.bottom <= viewRect.bottom + 1,
      sourceHasHeight: sourceRect.height > 100,
      previewHasHeight: previewRect.height > 100,
      stackedVertically: previewRect.top >= sourceRect.bottom - 1,
    };
  });
  expect(layout).toEqual({
    withinViewport: true,
    sourceHasHeight: true,
    previewHasHeight: true,
    stackedVertically: true,
  });
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


test("keeps mobile tag controls and selected note content within their containers", async ({ page }) => {
  await createSecuredProject(page);

  await page
    .getByLabel("Note title")
    .fill(`Long mobile note title ${"x".repeat(80)}`);

  await page.getByRole("button", { name: "Add tag" }).click();
  let input = page.getByRole("combobox", { name: "Add tag" });
  await input.fill("very-long-mobile-tag-alpha");
  await input.press("Enter");

  const firstTag = page.locator(".note-tag-control").first();
  await expect(firstTag.locator(".note-tag-remove")).toBeVisible();

  await page.getByRole("button", { name: "New note" }).click();
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill("Untagged mobile note");
  await page
    .getByRole("navigation", { name: "Notes" })
    .getByRole("button", { name: /Long mobile note title/ })
    .click();

  await page.setViewportSize({ width: 390, height: 844 });

  for (const tag of [
    "very-long-mobile-tag-beta",
    "very-long-mobile-tag-gamma",
  ]) {
    await page.getByRole("button", { name: "Add tag" }).click();
    input = page.getByRole("combobox", { name: "Add tag" });
    await input.fill(tag);
    await input.press("Enter");
  }

  await expect(firstTag.locator(".note-tag-remove")).toBeHidden();
  await firstTag.locator(".note-tag-color-summary").click();

  const removeFromMenu = firstTag.getByRole("button", { name: "Remove tag" });
  await expect(removeFromMenu).toBeVisible();
  await removeFromMenu.click();
  await expect(
    page.getByLabel("Change very-long-mobile-tag-alpha color"),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Open navigation" }).click();
  const selectedRow = page.locator(".note-row.selected");
  await expect(selectedRow).toBeVisible();

  const selectedContentFits = await selectedRow.evaluate((row) => {
    const item = row.querySelector(".note-item")!;
    const title = row.querySelector(".note-item-title")!;
    const tags = row.querySelector(".note-item-tags")!;
    const rowRect = row.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const tagsRect = tags.getBoundingClientRect();

    return (
      itemRect.left >= rowRect.left &&
      itemRect.right <= rowRect.right &&
      titleRect.left >= itemRect.left &&
      titleRect.right <= itemRect.right &&
      tagsRect.left >= itemRect.left &&
      tagsRect.right <= itemRect.right
    );
  });
  expect(selectedContentFits).toBe(true);

  const allRowsFit = await page.locator(".note-list").evaluate((list) => {
    const listRect = list.getBoundingClientRect();

    return [...list.querySelectorAll(".note-row")].every((row) => {
      const rowRect = row.getBoundingClientRect();
      const item = row.querySelector(".note-item");
      if (!item) return false;

      const itemRect = item.getBoundingClientRect();
      const tags = row.querySelector(".note-item-tags");
      const tagsRect = tags?.getBoundingClientRect();

      return (
        rowRect.left >= listRect.left &&
        rowRect.right <= listRect.right &&
        itemRect.left >= rowRect.left &&
        itemRect.right <= rowRect.right &&
        itemRect.top >= rowRect.top &&
        itemRect.bottom <= rowRect.bottom &&
        (!tagsRect ||
          (tagsRect.left >= itemRect.left &&
            tagsRect.right <= itemRect.right &&
            tagsRect.top >= itemRect.top &&
            tagsRect.bottom <= itemRect.bottom &&
            tagsRect.bottom <= rowRect.bottom))
      );
    });
  });
  expect(allRowsFit).toBe(true);

  await selectedRow.locator(".note-row-menu-trigger").click();
  const noteMenu = selectedRow.locator(".note-row-menu-popover");
  await expect(noteMenu).toBeVisible();
  const menuExtendsPastRow = await selectedRow.evaluate((row) => {
    const menu = row.querySelector(".note-row-menu-popover")!;
    return menu.getBoundingClientRect().bottom > row.getBoundingClientRect().bottom;
  });
  expect(menuExtendsPastRow).toBe(true);

  const moveAction = noteMenu.getByRole("button", { name: "Move note…" });
  await expect(moveAction).toBeVisible();
  await moveAction.click();
  await expect(page.getByRole("dialog", { name: "Move note…" })).toBeVisible();
});
