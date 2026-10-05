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

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "New note" }).click();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill("Untagged note");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Notes" })
    .getByRole("button", { name: "Welcome to Floe Note" })
    .click();

  await page.getByRole("button", { name: "Open navigation" }).click();

  const layoutIsStable = await page.locator(".note-list").evaluate((list) => {
    const tolerance = 1;
    const listStyle = getComputedStyle(list);

    if (listStyle.display !== "flex" || listStyle.flexDirection !== "column") {
      return false;
    }

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

      const rowStyle = getComputedStyle(row);
      const itemStyle = getComputedStyle(item);
      const title = item.querySelector<HTMLElement>(".note-item-title");
      if (!title) return false;

      const tags = item.querySelector<HTMLElement>(".note-item-tags");
      const titleHeight = title.getBoundingClientRect().height;
      const tagsHeight = tags?.getBoundingClientRect().height ?? 0;
      const gap = tags ? Number.parseFloat(itemStyle.rowGap || itemStyle.gap) || 0 : 0;
      const padding =
        (Number.parseFloat(itemStyle.paddingTop) || 0) +
        (Number.parseFloat(itemStyle.paddingBottom) || 0);
      const menuHeight =
        row.querySelector<HTMLElement>(".note-row-menu-trigger")
          ?.getBoundingClientRect().height ?? 0;
      const minHeight = Number.parseFloat(rowStyle.minHeight) || 0;
      const naturalHeight = Math.max(
        minHeight,
        menuHeight,
        titleHeight + tagsHeight + gap + padding,
      );

      if (rowRect.height > naturalHeight + tolerance) return false;

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

  expect(layoutIsStable).toBe(true);

  const selectedRow = page.locator(".note-row.selected");
  await expect(selectedRow).toBeVisible();
  await expect(selectedRow.locator(".note-item-tags")).toBeVisible();
});
