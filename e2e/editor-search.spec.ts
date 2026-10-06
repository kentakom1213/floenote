import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

async function expectSearchChromeInsideSource(
  page: import("@playwright/test").Page,
): Promise<void> {
  const fits = await page.locator(".editor-view-source").evaluate((source) => {
    const sourceRect = source.getBoundingClientRect();
    const panel = source.querySelector<HTMLElement>(".cm-search");
    if (!panel) return false;

    const tolerance = 1;
    const contains = (outer: DOMRect, inner: DOMRect) =>
      inner.left >= outer.left - tolerance &&
      inner.right <= outer.right + tolerance &&
      inner.top >= outer.top - tolerance &&
      inner.bottom <= outer.bottom + tolerance;

    const panelRect = panel.getBoundingClientRect();
    if (
      !contains(sourceRect, panelRect) ||
      panel.scrollWidth > panel.clientWidth + tolerance
    ) {
      return false;
    }

    const options = panel.querySelector<HTMLElement>(
      "[data-floe-search-options]",
    );
    if (
      options &&
      options.offsetParent !== null &&
      !contains(panelRect, options.getBoundingClientRect())
    ) {
      return false;
    }

    return [...panel.querySelectorAll<HTMLElement>("input, button")].every(
      (control) => {
        if (control.offsetParent === null) return true;
        return contains(sourceRect, control.getBoundingClientRect());
      },
    );
  });

  expect(fits).toBe(true);
}

test("keeps Search and Replace inside the source pane across widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await createSecuredProject(page);
  await page.getByRole("button", { name: "Hide sidebar" }).click();

  await page
    .getByLabel("Note view")
    .getByRole("button", { name: "Split" })
    .click();

  const source = page.locator(".editor-view-source");
  await expect(source).toBeVisible();

  const editor = source.locator('[contenteditable="true"]');
  await editor.press("Control+f");

  const searchPanel = source.locator(".cm-search");
  await expect(searchPanel).toBeVisible();

  const replaceToggle = searchPanel.locator("[data-floe-replace-toggle]");
  const optionsToggle = searchPanel.locator(
    "[data-floe-search-options-toggle]",
  );
  await expect(replaceToggle).toBeVisible();
  await expect(optionsToggle).toBeVisible();

  await replaceToggle.click();
  await expect(searchPanel.locator('input[name="replace"]')).toBeVisible();

  await optionsToggle.click();
  await expect(
    searchPanel.locator("[data-floe-search-options]"),
  ).toBeVisible();

  for (const width of [320, 360, 420, 520, 640, 760, 900, 1200, 1600, 2000]) {
    await page.setViewportSize({ width, height: 900 });
    await expectSearchChromeInsideSource(page);
  }
});
