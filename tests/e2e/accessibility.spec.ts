import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";

const JOURNEY_ID = "jrn_a11y01234567890ab";

/**
 * Accessibility smoke tests — assert zero critical/serious axe violations on each
 * main screen. Color contrast is excluded: it requires visual review and produces
 * false positives in test environments without real theming.
 */
async function runAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );

  return { blocking, all: results.violations };
}

test.describe("accessibility — no critical violations", () => {
  test("start screen", async ({ mocks, page }) => {
    await mocks.install({ journeyId: JOURNEY_ID });
    await page.goto("/");

    const { blocking } = await runAxe(page);
    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.description}`).join("\n"),
    ).toHaveLength(0);
  });

  test("alternatives screen", async ({ mocks, page }) => {
    await mocks.install({ journeyId: JOURNEY_ID });
    await page.goto(`/journey/${JOURNEY_ID}/alternatives`);
    // Wait for content to load
    await page.getByText(/Bessere Verbindungen|Aktuell keine/i).waitFor({
      timeout: 5_000,
    });

    const { blocking } = await runAxe(page);
    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.description}`).join("\n"),
    ).toHaveLength(0);
  });

  test("companion screen", async ({ mocks, companionPage, page }) => {
    await mocks.install({ journeyId: JOURNEY_ID });
    await companionPage.goto(JOURNEY_ID);
    await companionPage.expectLoaded();

    const { blocking } = await runAxe(page);
    expect(
      blocking,
      blocking.map((v) => `${v.id}: ${v.description}`).join("\n"),
    ).toHaveLength(0);
  });
});
