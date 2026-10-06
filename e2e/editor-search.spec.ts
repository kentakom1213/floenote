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
    const panelRect = panel.getBoundingClientRect();
    if (
      panelRect.left < sourceRect.left - tolerance ||
      panelRect.right > sourceRect.right + tolerance ||
      panel.scrollWidth > panel.clientWidth + tolerance
    ) {
      return false;
    }

    return [...panel.querySelectorAll<HTMLElement>("input, button")].every(
      (control) => {
        if (control.offsetParent === null) return true;
        const rect = control.getBoundingClientRect();
        return (
          rect.left >= sourceRect.left - tolerance &&
          rect.right <= sourceRect.right + tolerance
        );
      },
    );
  });

  expect(fits).toBe(true);
}

test("keeps Search and Replace inside a narrow Split source pane", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await createSecuredProject(page);

  await page
    .getByLabel("Note view")
    .getByRole("button", { name: "Split" })
    .click();

  const source = page.locator(".editor-view-source");
  await expect(source).toBeVisible();

  const sourceWidth = await source.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(sourceWidth).toBeGreaterThan(640);
  expect(sourceWidth).toBeLessThanOrEqual(760);

  const editor = source.locator('[contenteditable="true"]');
  await editor.press("Control+f");

  const searchPanel = source.locator(".cm-search");
  await expect(searchPanel).toBeVisible();

  const optionsToggle = searchPanel.locator(
    "[data-floe-search-options-toggle]",
  );
  await expect(optionsToggle).toBeVisible();

  await searchPanel.locator("[data-floe-replace-toggle]").click();
  await expect(searchPanel.locator('input[name="replace"]')).toBeVisible();
  await expectSearchChromeInsideSource(page);

  await page.getByRole("button", { name: "Hide sidebar" }).click();

  await expect
    .poll(() =>
      source.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(760);
  await expect(optionsToggle).toBeHidden();
  await expectSearchChromeInsideSource(page);
});
