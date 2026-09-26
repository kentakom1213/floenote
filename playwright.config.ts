import { defineConfig } from "@playwright/test";

const WEB_URL = "http://localhost:4173";
const COORDINATOR_URL = "http://127.0.0.1:8787";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
  webServer: [
    {
      command:
        "pnpm --filter @floe-note/coordinator exec wrangler dev --ip 127.0.0.1 --port 8787 --var FLOE_VERSION:e2e --var FLOE_BUILD:e2e",
      url: `${COORDINATOR_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command:
        "VITE_WEB_VERSION=e2e VITE_WEB_BUILD=e2e VITE_COORDINATOR_URL=http://127.0.0.1:8787 pnpm --filter @floe-note/web exec vite --host 127.0.0.1 --port 4173 --strictPort",
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
