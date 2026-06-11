import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E config — Verspätungsbegleiter
 *
 * Tests run against the full Docker Compose stack.
 * Set BASE_URL env var to point at the target environment.
 *
 * Run all:           npx playwright test
 * Run mobile only:   npx playwright test --project="Mobile Chrome"
 * Run one file:      npx playwright test golden-path.spec.ts
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL:        process.env.BASE_URL || 'http://localhost',
    trace:          'on-first-retry',
    screenshot:     'only-on-failure',
    video:          'on-first-retry',
    actionTimeout:  10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    // Primary: mobile (target audience)
    {
      name: 'Mobile Chrome (Pixel 5)',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari (iPhone 13)',
      use: { ...devices['iPhone 13'] },
    },
    // Secondary: desktop
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the full stack before running tests (CI uses pre-started stack)
  // webServer: {
  //   command: 'docker compose up --wait',
  //   url: 'http://localhost/health',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // },
})
