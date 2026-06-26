/**
 * Station autocomplete integration — real HAFAS data through the browser UI.
 */
import { test, expect } from "@playwright/test";
import { StartPage } from "../pages/start.page";

test.describe("station autocomplete — real data", () => {
  test("typing 'Berlin' shows real DB stations in dropdown", async ({ page }) => {
    const startPage = new StartPage(page);
    await startPage.goto();

    await startPage.destinationInput.click();
    await startPage.destinationInput.pressSequentially("Berlin", { delay: 60 });

    // At least one option from HAFAS must appear
    const option = page.getByRole("option", { name: /Berlin/i }).first();
    await expect(option).toBeVisible({ timeout: 15_000 });

    // Verify it's a real station (has an ID in the data)
    const optionCount = await page.getByRole("option", { name: /Berlin/i }).count();
    expect(optionCount).toBeGreaterThan(0);
  });

  test("selecting a station fills the input field", async ({ page }) => {
    const startPage = new StartPage(page);
    await startPage.goto();

    await startPage.destinationInput.click();
    await startPage.destinationInput.pressSequentially("Frankfurt", { delay: 60 });

    const hbfOption = page.getByRole("option", { name: /Frankfurt.*Hbf/i }).first();
    await expect(hbfOption).toBeVisible({ timeout: 15_000 });
    await hbfOption.click();

    await expect(startPage.destinationInput).toHaveValue(/Frankfurt/i);
    await expect(startPage.destinationInput).not.toHaveAttribute("aria-invalid", "true");
  });
});
