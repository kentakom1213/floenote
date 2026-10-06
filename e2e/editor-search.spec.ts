import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

async function expectSearchChromeInsideSource(
  page: import("@playwright/test").Page,
  viewportWidth: number,
): Promise<void> {
  const result = await page.locator(".editor-view-source").evaluate((source) => {
    const sourceRect = source.getBoundingClientRect();
    const panel = source.querySelector<HTMLElement>(".cm-search");
    if (!panel) return { reason: "search panel is missing" };

    const tolerance = 1;
    const containsInline = (outer: DOMRect, inner: DOMRect) =>
      inner.left >= outer.left - tolerance &&
      inner.right <= outer.right + tolerance;

    const panelRect = panel.getBoundingClientRect();
    if (!containsInline(sourceRect, panelRect)) {
      return { reason: "search panel exceeds source width" };
    }
    if (panel.scrollWidth > panel.clientWidth + tolerance) {
      return { reason: "search panel has horizontal overflow" };
    }

    const options = panel.querySelector<HTMLElement>(
      "[data-floe-search-options]",
    );
    if (
      options &&
      options.offsetParent !== null &&
      !containsInline(sourceRect, options.getBoundingClientRect())
    ) {
      return { reason: "search options exceed source width" };
    }

    for (const control of panel.querySelectorAll<HTMLElement>("input, button")) {
      if (control.offsetParent === null) continue;
      if (!containsInline(sourceRect, control.getBoundingClientRect())) {
        return {
          reason: `${control.tagName.toLowerCase()}[${control.getAttribute("name") ?? control.getAttribute("data-floe-search-options-toggle") !== null ? "options-toggle" : "unnamed"}] exceeds source width`,
        };
      }
    }

    return { reason: null };
  });

  expect(
    result.reason,
    `Search/Replace overflow at viewport width ${viewportWidth}px`,
  ).toBeNull();
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
    await expectSearchChromeInsideSource(page, width);
  }
});
