import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

async function createProject(page: import("@playwright/test").Page, name: string) {
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "New Project…" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Create Project" }).click();
  await expect(page.getByLabel(`Switch Project, current ${name}`)).toBeVisible();
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
  await expect(page.getByRole("button", { name: "New Project…" }).locator("svg")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Archived projects…" }).locator("svg")).toHaveCount(1);
  await page.getByRole("button", { name: "Manage Project…" }).click();
  await expect(page.getByRole("dialog", { name: "Manage Project" }).getByRole("button", { name: "Archive Project…" })).toBeDisabled();
  await page.getByRole("dialog", { name: "Manage Project" }).getByRole("button", { name: "Cancel" }).click();
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
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Manage Project…" }).click();
  await page.getByRole("button", { name: "Archive Project…" }).click();
  await page.getByRole("dialog", { name: "Archive Project" }).getByRole("button", { name: "Archive Project" }).click();
  await expect(page.getByLabel("Switch Project, current Notes")).toBeVisible();
  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Move note…" }).click();
  await expect(page.getByRole("dialog", { name: "Move note…" }).getByRole("button", { name: "Research" })).toHaveCount(0);
});

test("renames, archives, reopens and persists zero active Projects", async ({ page }) => {
  const { projectId } = await createSecuredProject(page);
  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page).toHaveURL(`/w/${projectId}`);

  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Manage Project…" }).click();
  await page.getByLabel("Project name").fill("Scratch");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("dialog", { name: "Manage Project" })).toHaveCount(0);
  await expect(page.getByLabel("Switch Project, current Scratch")).toBeVisible();

  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Manage Project…" }).click();
  await page.getByRole("button", { name: "Archive Project…" }).click();
  await page.getByRole("dialog", { name: "Archive Project" }).getByRole("button", { name: "Archive Project" }).click();
  await expect(page.getByRole("heading", { name: "No active Projects" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New note" })).toBeDisabled();
  await expect(page.getByLabel("Switch Project, current None")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Project", exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Unlock Floe Note" }).click();
  await expect(page.getByRole("heading", { name: "No active Projects" })).toBeVisible();
  await page.getByRole("button", { name: "Reopen archived Project" }).click();
  await page.getByRole("dialog", { name: "Archived projects" }).getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByLabel("Switch Project, current Scratch")).toBeVisible();

  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Manage Project…" }).click();
  await page.getByRole("button", { name: "Archive Project…" }).click();
  await page.getByRole("dialog", { name: "Archive Project" }).getByRole("button", { name: "Archive Project" }).click();

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("button", { name: "Welcome to Floe Note" }).last().click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByLabel("Switch Project, current Scratch")).toBeVisible();
});

test("creates a Project from the zero-active empty state", async ({ page }) => {
  await createSecuredProject(page);
  await page.getByLabel("Note actions").click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Manage Project…" }).click();
  await page.getByRole("button", { name: "Archive Project…" }).click();
  await page.getByRole("dialog", { name: "Archive Project" }).getByRole("button", { name: "Archive Project" }).click();
  await page.getByRole("button", { name: "Create Project", exact: true }).click();
  await page.getByLabel("Project name").fill("Fresh start");
  await page.getByRole("dialog").getByRole("button", { name: "Create Project" }).click();
  await expect(page.getByLabel("Switch Project, current Fresh start")).toBeVisible();
  await expect(page.getByRole("button", { name: "New note" })).toBeEnabled();
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

  const longName = `Research ${"very-long-project-name-".repeat(8)}`;
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
  await page.getByRole("button", { name: "Manage Project…" }).click();
  await page.getByRole("button", { name: "Archive Project…" }).click();
  await page.getByRole("dialog", { name: "Archive Project" }).getByRole("button", { name: "Archive Project" }).click();

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

test("shows Project management across the mobile viewport and closes after saving", async ({ page }) => {
  await createSecuredProject(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByLabel(/Switch Project, current/).click();
  await page.getByRole("button", { name: "Manage Project…" }).click();

  const dialog = page.getByRole("dialog", { name: "Manage Project" });
  await expect(dialog).toBeVisible();
  const backdrop = await page.locator(".dialog-backdrop").boundingBox();
  expect(backdrop?.width).toBe(390);

  await page.getByLabel("Project name").fill("Mobile notes");
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Switch Project, current Mobile notes")).toBeVisible();
});
