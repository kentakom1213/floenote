import type { Page } from "@playwright/test";

import { expect } from "./fixtures.js";

export async function createSecuredProject(
  page: Page,
  projectName = "Personal",
): Promise<{ projectId: string; documentId: string }> {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Local-first notes, across your devices",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Start writing" }).click();

  await expect(
    page.getByRole("heading", { name: "Secure this device" }),
  ).toBeVisible();

  await page.getByLabel("Device name").fill("Playwright Chromium");
  const projectSecurityCommit = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === "http://127.0.0.1:8787" &&
      /^\/workspaces\/[^/]+\/security\/transitions$/.test(url.pathname) &&
      response.request().method() === "POST"
    );
  });

  await page.getByRole("button", { name: "Create new passkey" }).click();
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

  if (projectName !== "Personal") {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Workspace" }).click();
    await page.getByLabel("Workspace name").fill(projectName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("navigation", { name: "Notes" })
      .getByRole("button", { name: "Welcome to Floe Note" }).click();
  }

  return {
    projectId: match[1]!,
    documentId: match[2]!,
  };
}
