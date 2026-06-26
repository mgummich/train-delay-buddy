import { defineConfig, devices } from "@playwright/test";

/**
 * Full-stack integration config — spins up docker compose and runs against
 * the real HAFAS sidecar, Postgres, and Valkey.
 *
 * Local:  npx playwright test --config playwright.integration.config.ts
 * Keep stack alive after run:
 *         INTEGRATION_KEEP_STACK=1 npx playwright test --config playwright.integration.config.ts
 * Target existing stack:
 *         INTEGRATION_SKIP_SETUP=1 npx playwright test --config playwright.integration.config.ts
 */
export default defineConfig({
  testDir: "./integration",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  timeout: 180_000,
  globalSetup: process.env.INTEGRATION_SKIP_SETUP ? undefined : "./global-setup.ts",
  globalTeardown: process.env.INTEGRATION_SKIP_SETUP ? undefined : "./global-teardown.ts",
  reporter: [["html", { open: "never", outputFolder: "playwright-report-integration" }]],

  use: {
    // Use nginx (port 80) — the production build has no MSW service worker.
    // Vite dev (:5173) installs MSW in-browser and would intercept all API calls.
    baseURL: process.env.BASE_URL ?? "http://localhost",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Real HAFAS hub searches can take 60–90 s for a train departing mid-day.
    actionTimeout: 90_000,
    navigationTimeout: 30_000,
  },

  projects: [
    { name: "Desktop Chrome", use: { ...devices["Desktop Chrome"] } },
  ],
});
