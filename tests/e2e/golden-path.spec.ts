import { test, expect } from "./fixtures/test";
import { DEFAULT_JOURNEY_ID } from "./fixtures/mocks";

test.describe("golden path — train → alternatives → companion", () => {
  test.beforeEach(async ({ mocks }) => {
    await mocks.install();
  });

  test("navigates from start to companion in < 30s", async ({
    startPage,
    alternativesPage,
    companionPage,
  }) => {
    const start = Date.now();
    await startPage.goto();
    await startPage.startJourney();

    await alternativesPage.expectVisible();
    await alternativesPage.selectFirst();

    await companionPage.expectLoaded();
    expect(Date.now() - start).toBeLessThan(30_000);
  });

  test("URL contains journeyId after navigation", async ({
    startPage,
    alternativesPage,
    page,
  }) => {
    await startPage.goto();
    await startPage.startJourney();
    await alternativesPage.expectVisible();
    await alternativesPage.selectFirst();
    expect(page.url()).toMatch(/\/journey\/jrn_[0-9a-z]{12,26}\/companion/);
  });

  test("ETA displayed in Europe/Berlin time (19:24 for 17:24 UTC)", async ({
    startPage,
    alternativesPage,
    companionPage,
  }) => {
    await startPage.goto();
    await startPage.startJourney();
    await alternativesPage.expectVisible();
    await alternativesPage.selectFirst();
    // 2026-06-11T17:24:00Z = 19:24 CEST (UTC+2)
    await expect(companionPage.eta).toHaveText("19:24");
  });

  test("plausibility dialog shown when confidence is low", async ({
    startPage,
    mocks,
    page,
  }) => {
    await mocks.overrideJourneyCreatePlausibilityLow(DEFAULT_JOURNEY_ID);

    await startPage.goto();
    await startPage.startJourney();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByText(/konnten nicht sicher feststellen/i)).toBeVisible();
    await page.getByRole("button", { name: /Ja, Route planen/i }).click();
    await expect(page).toHaveURL(/\/journey\/.*\/alternatives/);
  });

  test('"Reise abschließen" terminates and returns to start', async ({
    startPage,
    alternativesPage,
    companionPage,
    page,
  }) => {
    await startPage.goto();
    await startPage.startJourney();
    await alternativesPage.expectVisible();
    await alternativesPage.selectFirst();
    await companionPage.expectLoaded();

    await companionPage.terminate();
    await expect(page).toHaveURL("/");
  });

  test('"Reise abschließen" shows inline error when DELETE fails', async ({
    startPage,
    alternativesPage,
    companionPage,
    page,
  }) => {
    await startPage.goto();
    await startPage.startJourney();
    await alternativesPage.expectVisible();
    await alternativesPage.selectFirst();
    await companionPage.expectLoaded();

    // Override DELETE to 500 — companion is already loaded so this only affects terminate
    await page.route("**/journeys/**", async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({ status: 500 });
        return;
      }
      await route.continue();
    });

    await companionPage.terminate();

    await expect(companionPage.finishError).toBeVisible({ timeout: 5_000 });
    // User stays on companion — not navigated away
    await expect(page).toHaveURL(/\/companion/);
  });

});
