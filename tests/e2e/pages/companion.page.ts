import { expect, type Locator, type Page } from "@playwright/test";

export class CompanionPage {
  readonly screen: Locator;
  readonly summaryHeader: Locator;
  readonly timeline: Locator;
  readonly eta: Locator;
  readonly criticalWarning: Locator;
  readonly criticalTransferText: Locator;
  readonly routeNotUsableText: Locator;
  readonly liveRegion: Locator;
  readonly staleIndicator: Locator;
  readonly companionError: Locator;
  readonly finishError: Locator;
  readonly terminateButton: Locator;
  readonly seeAlternativesButton: Locator;
  readonly findNewConnectionButton: Locator;

  constructor(readonly page: Page) {
    this.screen = page.getByTestId("companion-screen");
    this.summaryHeader = page.getByTestId("summary-header");
    this.timeline = page.getByTestId("timeline");
    this.eta = page.getByTestId("eta");
    this.criticalWarning = page.getByTestId("critical-warning");
    this.criticalTransferText = page.getByText(/Umstieg kritisch|kritisch/i);
    this.routeNotUsableText = page.getByText(/Route nicht mehr nutzbar|nicht mehr nutzbar/i);
    this.liveRegion = this.screen.locator('[role="alert"], [aria-live="assertive"]');
    this.staleIndicator = page.getByTestId("stale-indicator");
    this.companionError = page.getByTestId("companion-error");
    this.finishError = page.getByTestId("finish-error");
    this.terminateButton = page.getByRole("button", { name: /Reise abschließen/i });
    this.seeAlternativesButton = page.getByRole("button", {
      name: /Alternative ansehen|Alternativen/i,
    });
    this.findNewConnectionButton = page.getByRole("button", {
      name: /Neue Verbindung suchen/i,
    });
  }

  async goto(journeyId: string): Promise<void> {
    await this.page.goto(`/journey/${journeyId}/companion`);
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/journey\/.*\/companion/);
    await expect(this.summaryHeader).toBeVisible({ timeout: 5_000 });
    await expect(this.timeline).toBeVisible();
  }

  async terminate(): Promise<void> {
    await this.terminateButton.click();
  }
}
