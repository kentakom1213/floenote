import { defineConfig } from "@playwright/test";

const WEB_URL = "http://127.0.0.1:4173";
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
      command: "pnpm --filter @floe-note/coordinator dev",
      url: `${COORDINATOR_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "VITE_COORDINATOR_URL=http://127.0.0.1:8787 pnpm --filter @floe-note/web dev -- --host 127.0.0.1 --port 4173 --strictPort",
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
