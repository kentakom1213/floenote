import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("Tab and Shift+Tab indent Markdown without breaking search or Loro undo", async ({
  page,
}) => {
  await createSecuredProject(page, "Indentation Project");

  const editor = page.locator('.editor [contenteditable="true"]');
  await expect(editor).toBeVisible();

  await editor.fill("plain text");
  await editor.press("Tab");
  await expect(editor).toHaveText("   plain text");

  await editor.press("Shift+Tab");
  await expect(editor).toHaveText("plain text");

  await editor.fill("- parent\n- item");
  await editor.press("Tab");
  await expect(editor).toHaveText("- parent\n   - item");
  await editor.press("Shift+Tab");
  await expect(editor).toHaveText("- parent\n- item");

  await editor.fill("- parent\n- [ ] task");
  await editor.press("Tab");
  await expect(editor).toHaveText("- parent\n   - [ ] task");
  await editor.press("Shift+Tab");
  await expect(editor).toHaveText("- parent\n- [ ] task");

  await editor.fill("1. parent\n2. numbered");
  await editor.press("Tab");
  await expect(editor).toHaveText("1. parent\n   2. numbered");

  await editor.press("Control+z");
  await expect(editor).toHaveText("1. parent\n2. numbered");

  await editor.press("Control+Shift+z");
  await expect(editor).toHaveText("1. parent\n   2. numbered");

  await editor.press("Control+f");
  const searchInput = page.locator('.cm-search input[name="search"]');
  await expect(searchInput).toBeVisible();

  const beforeSearchTab = await editor.innerText();
  await searchInput.press("Tab");
  await expect(editor).toHaveText(beforeSearchTab);
});
