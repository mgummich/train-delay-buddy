import { expect, type Locator, type Page } from "@playwright/test";

export class AlternativesPage {
  readonly alternativeCards: Locator;
  readonly chooseRouteButton: Locator;
  readonly timeGainHint: Locator;
  readonly filterButton: Locator;

  constructor(readonly page: Page) {
    this.alternativeCards = page.getByTestId("alternative-card");
    this.chooseRouteButton = page.getByRole("button", { name: /Route wählen/i });
    this.timeGainHint = page.getByText(/früher am Ziel|früher ankommen/i);
    this.filterButton = page.getByRole("button", { name: /^Filter/ });
  }

  filterChip(label: string): Locator {
    return this.page.getByRole("button", { name: `${label} Filter entfernen` });
  }

  async openFilterSheet(): Promise<void> {
    await this.filterButton.click();
    await expect(this.page.getByRole("dialog")).toBeVisible();
  }

  async closeFilterSheet(): Promise<void> {
    await this.page.getByRole("button", { name: /Verbindungen anzeigen|Keine Treffer/i }).click();
  }

  async expectVisible(): Promise<void> {
    await expect(this.page).toHaveURL(/\/journey\/.*\/alternatives/);
    await expect(this.timeGainHint).toBeVisible({ timeout: 10_000 });
  }

  async selectFirst(): Promise<void> {
    await this.alternativeCards.first().click();
    await Promise.all([
      this.page.waitForURL(/\/journey\/.*\/companion/),
      this.chooseRouteButton.click(),
    ]);
  }
}
