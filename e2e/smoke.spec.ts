import { expect, test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("creates a secured workspace and edits the initial note", async ({ page }) => {
  await createSecuredProject(page);

  const title = page.getByLabel("Note title");
  await expect(title).toHaveValue("Welcome to Floe Note");
  await title.fill("Smoke test note");
  await expect(title).toHaveValue("Smoke test note");
});
