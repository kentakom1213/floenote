import { test } from "./fixtures.js";
import { createSecuredProject } from "./project.js";

test("creates a secured Project with a virtual PRF passkey", async ({ page }) => {
  await createSecuredProject(page);
});
