import { expect, type Locator, type Page } from "@playwright/test";

export class AlternativesPage {
  readonly alternativeCards: Locator;
  readonly chooseRouteButton: Locator;
  readonly timeGainHint: Locator;

  constructor(readonly page: Page) {
    this.alternativeCards = page.getByTestId("alternative-card");
    this.chooseRouteButton = page.getByRole("button", { name: /Route wählen/i });
    this.timeGainHint = page.getByText(/früher am Ziel|früher ankommen/i);
  }

  async expectVisible(): Promise<void> {
    await expect(this.page).toHaveURL(/\/journey\/.*\/alternatives/);
    await expect(this.timeGainHint).toBeVisible({ timeout: 10_000 });
  }

  async selectFirst(): Promise<void> {
    await this.alternativeCards.first().click();
    await this.chooseRouteButton.click();
  }
}
