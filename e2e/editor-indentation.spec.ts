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
  await expect.poll(() => editor.innerText()).toBe("  plain text");
  await expect(editor).toBeFocused();

  await editor.press("Shift+Tab");
  await expect.poll(() => editor.innerText()).toBe("plain text");

  await editor.fill("- parent\n- child");
  await editor.press("Tab");
  await expect.poll(() => editor.innerText()).toBe("- parent\n  - child");
  await editor.press("Shift+Tab");
  await expect.poll(() => editor.innerText()).toBe("- parent\n- child");

  await editor.fill("- [ ] parent\n- [ ] child");
  await editor.press("Tab");
  await expect
    .poll(() => editor.innerText())
    .toBe("- [ ] parent\n  - [ ] child");
  await editor.press("Shift+Tab");
  await expect
    .poll(() => editor.innerText())
    .toBe("- [ ] parent\n- [ ] child");

  await editor.fill("1. parent\n2. child");
  await editor.press("Tab");
  await expect.poll(() => editor.innerText()).toBe("1. parent\n   2. child");

  await editor.press("Control+z");
  await expect.poll(() => editor.innerText()).toBe("1. parent\n2. child");

  await editor.press("Control+y");
  await expect.poll(() => editor.innerText()).toBe("1. parent\n   2. child");

  await editor.fill("10. parent\n11. child");
  await editor.press("Tab");
  await expect
    .poll(() => editor.innerText())
    .toBe("10. parent\n    11. child");
  await editor.press("Shift+Tab");
  await expect.poll(() => editor.innerText()).toBe("10. parent\n11. child");

  await editor.fill("~~~text\ncode\n~~~");
  await page.keyboard.press("ArrowUp");
  await editor.press("Tab");
  await expect.poll(() => editor.innerText()).toBe("~~~text\n  code\n~~~");

  await editor.press("Control+f");
  const searchInput = page.locator('.cm-search input[name="search"]');
  await expect(searchInput).toBeVisible();

  const beforeSearchTab = await editor.innerText();
  await searchInput.press("Tab");
  await expect.poll(() => editor.innerText()).toBe(beforeSearchTab);
});
