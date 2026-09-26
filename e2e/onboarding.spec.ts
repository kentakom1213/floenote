import { expect, test } from "./fixtures.js";

test("creates a secured Project with a virtual PRF passkey", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Choose how to begin" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create a Project" }).click();

  await expect(
    page.getByRole("heading", { name: "Secure this device" }),
  ).toBeVisible();

  await page.getByLabel("Device name").fill("Playwright Chromium");

  await page.getByRole("button", { name: "Create new passkey" }).click();

  await expect(
    page.getByRole("heading", { name: "Create a Project" }),
  ).toBeVisible();

  await page.getByLabel("Project name").fill("Playwright Project");
  const projectSecurityCommit = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === "http://127.0.0.1:8787" &&
      /^\/projects\/[^/]+\/security\/transitions$/.test(url.pathname) &&
      response.request().method() === "POST" &&
      response.status() === 201
    );
  });

  await page.getByRole("button", { name: "Create", exact: true }).click();

  await projectSecurityCommit;

  await expect(page.getByLabel("Note title")).toHaveValue(
    "Welcome to Floe Note",
  );
  await expect(page).toHaveURL(
    /\/p\/[0-9a-f-]+\/[0-9a-f-]+$/,
  );
});
