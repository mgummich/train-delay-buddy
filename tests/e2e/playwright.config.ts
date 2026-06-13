import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config — Verspätungsbegleiter
 *
 * All API calls are mocked via page.route() — no backend required.
 * The webServer block auto-starts `vite preview` on :4173 before the suite.
 *
 * Local:  npx playwright test
 * UI:     npx playwright test --ui
 * One:    npx playwright test golden-path.spec.ts
 * Mobile: npx playwright test --project="Mobile Chrome (Pixel 5)"
 *
 * Override target: BASE_URL=http://my-server npx playwright test
 */
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 50_000,
  reporter: isCI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "html",

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,

  },

  projects: [
    { name: "Mobile Chrome (Pixel 5)", use: { ...devices["Pixel 5"] } },
    { name: "Desktop Chrome", use: { ...devices["Desktop Chrome"] } },
    // Mobile Safari runs locally only — webkit deps are heavy on CI.
    ...(isCI
      ? []
      : [{ name: "Mobile Safari (iPhone 13)", use: { ...devices["iPhone 13"] } }]),
  ],

  // Auto-start vite preview; no backend or Docker needed (all API mocked).
  // Set BASE_URL to skip this and target an external instance instead.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command:
          "npm --prefix ../../frontend run preview -- --host 127.0.0.1 --port 4173",
        url: "http://localhost:4173",
        reuseExistingServer: !isCI,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
