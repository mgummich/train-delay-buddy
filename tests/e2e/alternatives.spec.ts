import { test, expect } from "./fixtures/test";

const JOURNEY_ID = "jrn_altsspec01234567";

test.describe("alternatives screen — filters", () => {
  test.beforeEach(async ({ mocks }) => {
    await mocks.install({ journeyId: JOURNEY_ID });
  });

  test("DB-only filter chip shown by default", async ({ alternativesPage, page }) => {
    await page.goto(`/journey/${JOURNEY_ID}/alternatives`);
    await alternativesPage.expectVisible();

    // "Nur DB" chip visible — dbOnly defaults to true in installStore
    await expect(alternativesPage.filterChip("Nur DB")).toBeVisible();
  });

  test("chip remove button turns off DB-only filter", async ({
    alternativesPage,
    page,
  }) => {
    await page.goto(`/journey/${JOURNEY_ID}/alternatives`);
    await alternativesPage.expectVisible();

    await alternativesPage.filterChip("Nur DB").click();

    // Chip gone after removal
    await expect(alternativesPage.filterChip("Nur DB")).not.toBeVisible();
    // Filter badge count on filter button should disappear too
    await expect(page.getByTestId("filter-count")).not.toBeVisible();
  });

  test("FilterSheet toggle turns off DB-only filter", async ({
    alternativesPage,
    page,
  }) => {
    await page.goto(`/journey/${JOURNEY_ID}/alternatives`);
    await alternativesPage.expectVisible();

    await alternativesPage.openFilterSheet();

    // Toggle is checked — click to turn off
    const toggle = page.getByRole("switch", { name: "Nur DB-Züge" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    await alternativesPage.closeFilterSheet();

    // Chip should be gone now
    await expect(alternativesPage.filterChip("Nur DB")).not.toBeVisible();
  });
});

test.describe("alternatives screen — recalculate", () => {
  test("Neu berechnen button triggers POST and refreshes list", async ({
    mocks,
    alternativesPage,
    page,
  }) => {
    await mocks.install({ journeyId: JOURNEY_ID });
    await page.goto(`/journey/${JOURNEY_ID}/alternatives`);
    await alternativesPage.expectVisible();

    let postCalled = false;
    await page.route(`**/journeys/${JOURNEY_ID}/alternatives`, async (route) => {
      if (route.request().method() === "POST") {
        postCalled = true;
        await route.fulfill({ status: 202, json: { status: "computing" } });
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: /Neu berechnen/i }).click();

    await expect
      .poll(() => postCalled, { timeout: 5_000 })
      .toBe(true);
  });
});
