import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});

test("contains mixed tagged and untagged notes inside mobile sidebar rows", async ({
  page,
}) => {
  await createSecuredProject(page);

  await page.getByRole("button", { name: "Add tag" }).click();
  let tagInput = page.getByRole("combobox", { name: "Add tag" });
  await tagInput.fill("new-life");
  await tagInput.press("Enter");
  await page.getByRole("button", { name: "Add tag" }).click();
  tagInput = page.getByRole("combobox", { name: "Add tag" });
  await tagInput.fill("LY");
  await tagInput.press("Enter");

  await page.getByRole("button", { name: "New note" }).click();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill("Untagged note");

  await page
    .getByRole("navigation", { name: "Notes" })
    .getByRole("button", { name: "Welcome to Floe Note" })
    .click();

  await page.getByRole("button", { name: "Open navigation" }).click();

  const rowsFit = await page.locator(".note-list").evaluate((list) => {
    const tolerance = 1;

    const contains = (outer: DOMRect, inner: DOMRect) =>
      inner.left >= outer.left - tolerance &&
      inner.right <= outer.right + tolerance &&
      inner.top >= outer.top - tolerance &&
      inner.bottom <= outer.bottom + tolerance;

    return [...list.querySelectorAll(".note-row")].every((row) => {
      const item = row.querySelector<HTMLElement>(".note-item");
      if (!item) return false;

      const rowRect = row.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      if (!contains(rowRect, itemRect)) return false;
      if (row.scrollHeight > row.clientHeight + tolerance) return false;
      if (item.scrollHeight > item.clientHeight + tolerance) return false;

      const tags = item.querySelector<HTMLElement>(".note-item-tags");
      if (!tags) return true;

      const tagsRect = tags.getBoundingClientRect();
      if (!contains(itemRect, tagsRect) || !contains(rowRect, tagsRect)) {
        return false;
      }
      if (tags.scrollHeight > tags.clientHeight + tolerance) return false;

      return [...tags.querySelectorAll(".tag-chip")].every((chip) => {
        const chipRect = chip.getBoundingClientRect();
        return (
          contains(tagsRect, chipRect) &&
          contains(itemRect, chipRect) &&
          contains(rowRect, chipRect)
        );
      });
    });
  });

  expect(rowsFit).toBe(true);

  const selectedRow = page.locator(".note-row.selected");
  await expect(selectedRow).toBeVisible();
  await expect(selectedRow.locator(".note-item-tags")).toBeVisible();
});
