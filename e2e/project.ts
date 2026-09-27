import type { Page } from "@playwright/test";

import { expect } from "./fixtures.js";

export async function createSecuredProject(
  page: Page,
  projectName = "Playwright Project",
): Promise<{ projectId: string; documentId: string }> {
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

  await page.getByLabel("Project name").fill(projectName);

  const projectSecurityCommit = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === "http://127.0.0.1:8787" &&
      /^\/workspaces\/[^/]+\/security\/transitions$/.test(url.pathname) &&
      response.request().method() === "POST"
    );
  });

  await page.getByRole("button", { name: "Create", exact: true }).click();
  const projectSecurityResponse = await projectSecurityCommit;
  expect(projectSecurityResponse.status()).toBe(201);

  await expect(page.getByLabel("Note title")).toHaveValue(
    "Welcome to Floe Note",
  );
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/n\/[0-9a-f-]+$/);

  const match = /^\/w\/([^/]+)\/n\/([^/]+)$/.exec(new URL(page.url()).pathname);
  if (!match) {
    throw new Error("Expected canonical Workspace note URL");
  }

  return {
    projectId: match[1]!,
    documentId: match[2]!,
  };
}
