import { test, expect } from "./fixtures/test";
import { makeSummary } from "./fixtures/mocks";

const JOURNEY_ID = "jrn_offline0123456789";

test.describe("offline degradation", () => {
  test("companion shows stale data when network drops", async ({
    mocks,
    companionPage,
    context,
  }) => {
    await mocks.install({ journeyId: JOURNEY_ID });

    await companionPage.goto(JOURNEY_ID);
    const etaBefore = await companionPage.eta.textContent();
    expect(etaBefore).toBeTruthy();

    await context.setOffline(true);

    // 35s: poll cycle is ~30s; allow one full cycle before asserting stale state
    await expect(companionPage.staleIndicator).toBeVisible({ timeout: 35_000 });
    await expect(companionPage.eta).toBeVisible();
    await expect(companionPage.eta).toHaveText(etaBefore!);
    await expect(
      companionPage.page.getByText(/Offline|veraltet|Zuletzt aktualisiert/i),
    ).toBeVisible();
    await expect(companionPage.summaryHeader).toBeVisible();
    await expect(companionPage.timeline).toBeVisible();
  });

  test("auto-recovers when network restores", async ({
    mocks,
    companionPage,
    context,
  }) => {
    await mocks.install({
      journeyId: JOURNEY_ID,
      summary: makeSummary({ eta: "2026-06-11T17:15:00Z" }),
      rotatingETag: true,
    });

    await companionPage.goto(JOURNEY_ID);
    await expect(companionPage.eta).toBeVisible();

    await context.setOffline(true);
    // 35s: poll cycle is ~30s; allow one full cycle before asserting stale state
    await expect(companionPage.staleIndicator).toBeVisible({ timeout: 35_000 });

    await context.setOffline(false);
    await expect(companionPage.staleIndicator).not.toBeVisible({ timeout: 35_000 });
  });

  test("no blank screen on direct URL navigation when offline", async ({
    mocks,
    companionPage,
    context,
    page,
  }) => {
    await context.setOffline(true);
    await mocks.abortAllJourneys();

    await companionPage.goto(JOURNEY_ID);

    try {
      await expect(companionPage.companionError).toBeVisible({ timeout: 5_000 });
    } catch {
      await expect(page).toHaveURL("/");
    }
  });
});
