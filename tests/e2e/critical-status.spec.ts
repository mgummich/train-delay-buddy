import { test, expect } from "./fixtures/test";

const JOURNEY_ID = "jrn_critical01234567";

test.describe("critical status", () => {
  test("shows warning banner and alternative CTA when status is critical", async ({
    mocks,
    companionPage,
  }) => {
    await mocks.install({
      journeyId: JOURNEY_ID,
      summary: {
        status: "critical",
        minTransferBufferMinutes: 3,
        criticalTransfer: true,
        alternativeAvailable: true,
      },
    });

    await companionPage.goto(JOURNEY_ID);

    await expect(companionPage.criticalWarning).toBeVisible({ timeout: 5_000 });
    await expect(companionPage.criticalTransferText).toBeVisible();
    await expect(companionPage.seeAlternativesButton).toBeVisible();
  });

  test("critical warning NOT shown when status is ok", async ({
    mocks,
    companionPage,
  }) => {
    await mocks.install({
      journeyId: JOURNEY_ID,
      summary: { status: "ok", minTransferBufferMinutes: 12 },
    });
    await companionPage.goto(JOURNEY_ID);

    await expect(companionPage.summaryHeader).toBeVisible();
    await expect(companionPage.criticalWarning).not.toBeVisible();
  });

  test("failed status shows route-not-usable UI and restart CTA", async ({
    mocks,
    companionPage,
  }) => {
    await mocks.install({
      journeyId: JOURNEY_ID,
      summary: { status: "failed" },
    });
    await companionPage.goto(JOURNEY_ID);

    await expect(companionPage.routeNotUsableText).toBeVisible({ timeout: 5_000 });
    await expect(companionPage.findNewConnectionButton).toBeVisible();
  });

  test("aria-live region announces critical transition to screen readers", async ({
    mocks,
    companionPage,
  }) => {
    await mocks.install({
      journeyId: JOURNEY_ID,
      summary: { status: "critical", criticalTransfer: true },
    });
    await companionPage.goto(JOURNEY_ID);

    await expect(companionPage.liveRegion).toBeAttached();
  });
});
