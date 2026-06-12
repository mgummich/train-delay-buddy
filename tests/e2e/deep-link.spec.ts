import { test, expect } from "./fixtures/test";

const JOURNEY_ID = "jrn_deeplink0123456789";

test.describe("URL routing and deep-links", () => {
  test("direct URL to companion loads journey", async ({ mocks, companionPage }) => {
    await mocks.install({ journeyId: JOURNEY_ID });

    await companionPage.goto(JOURNEY_ID);
    await expect(companionPage.screen).toBeVisible({ timeout: 5_000 });
    await expect(companionPage.eta).toBeVisible();
  });

  test("direct URL to unknown journeyId redirects to /", async ({
    mocks,
    companionPage,
    page,
  }) => {
    await mocks.setAllJourneysNotFound();

    await companionPage.goto("jrn_doesnotexist");
    await expect(page).toHaveURL("/");
  });

  test("browser refresh on companion retains journey state", async ({
    mocks,
    companionPage,
    page,
  }) => {
    await mocks.install({ journeyId: JOURNEY_ID });

    await companionPage.goto(JOURNEY_ID);
    await expect(companionPage.screen).toBeVisible();

    await page.reload();
    await expect(companionPage.screen).toBeVisible({ timeout: 5_000 });
    await expect(companionPage.eta).toBeVisible();
  });

  test("browser back from companion to alternatives works", async ({
    mocks,
    page,
  }) => {
    await mocks.install({ journeyId: JOURNEY_ID, alternatives: [] });

    await page.goto(`/journey/${JOURNEY_ID}/alternatives`);
    await page.goto(`/journey/${JOURNEY_ID}/companion`);
    await expect(page).toHaveURL(/companion/);

    await page.goBack();
    await expect(page).toHaveURL(/alternatives/);
  });
});
