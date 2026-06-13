import { test, expect } from "./fixtures/test";

test.describe("start screen — form validation", () => {
  test("submit button disabled on initial load", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /Beste Verbindung/i }),
    ).toBeDisabled();
  });

  test("train field error when train is not found today", async ({ mocks, page }) => {
    await mocks.setTrainNotFound();
    // Stations still needed so destination autocomplete works, but not required for this test.
    await page.goto("/");

    await page.getByLabel(/Zugnummer/i).fill("ICE 404");
    await page.getByLabel(/Zugnummer/i).blur();

    await expect(
      page.getByText("Zug nicht gefunden für heute"),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: /Beste Verbindung/i }),
    ).toBeDisabled();
  });

  test("submit button stays disabled when destination not selected", async ({
    mocks,
    startPage,
    page,
  }) => {
    await mocks.install();
    await startPage.goto();

    // Fill valid train only — destination left empty
    await startPage.trainNumberInput.fill("ICE 123");
    await startPage.trainNumberInput.blur();

    // Wait for train validation to complete
    await expect(page.getByText("Zug nicht gefunden für heute")).not.toBeVisible({
      timeout: 5_000,
    });

    // Button still disabled — destination missing
    await expect(
      page.getByRole("button", { name: /Beste Verbindung/i }),
    ).toBeDisabled();
  });

  test("journey create API error sets field-level error", async ({
    mocks,
    startPage,
    page,
  }) => {
    await mocks.install();
    // Override POST /journeys to return a field error
    await page.route("**/journeys", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 422,
        json: {
          errors: [{ field: "trainNumber", message: "Zug fährt heute nicht" }],
        },
      });
    });

    await startPage.goto();
    await startPage.startJourney();

    await expect(page.getByText("Zug fährt heute nicht")).toBeVisible({
      timeout: 5_000,
    });
  });
});
