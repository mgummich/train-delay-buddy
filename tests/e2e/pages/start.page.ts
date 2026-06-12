import { expect, type Locator, type Page } from "@playwright/test";

export class StartPage {
  readonly trainNumberInput: Locator;
  readonly destinationInput: Locator;
  readonly submitButton: Locator;

  constructor(readonly page: Page) {
    this.trainNumberInput = page.getByLabel(/Zugnummer/i);
    this.destinationInput = page.getByLabel(/Zielbahnhof/i);
    this.submitButton = page.getByRole("button", { name: /Beste Verbindung/i });
  }

  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  async fillTrain(number: string): Promise<void> {
    await this.trainNumberInput.fill(number);
    await this.trainNumberInput.blur();
    await expect(this.trainNumberInput).not.toHaveAttribute("aria-invalid", "true");
  }

  async pickDestination(query: string, optionPattern: RegExp): Promise<void> {
    await this.destinationInput.fill(query);
    const option = this.page.getByRole("option", { name: optionPattern });
    await expect(option).toBeVisible();
    await option.click();
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /** Convenience: full happy-path form fill + submit. */
  async startJourney(
    train = "ICE 123",
    destQuery = "Frank",
    destPattern = /Frankfurt.*Hbf/i,
  ): Promise<void> {
    await this.fillTrain(train);
    await this.pickDestination(destQuery, destPattern);
    await this.submit();
  }
}
