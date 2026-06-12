import { test as base } from "@playwright/test";
import { StartPage } from "../pages/start.page";
import { AlternativesPage } from "../pages/alternatives.page";
import { CompanionPage } from "../pages/companion.page";
import { MockServer } from "./mocks";

type Fixtures = {
  startPage: StartPage;
  alternativesPage: AlternativesPage;
  companionPage: CompanionPage;
  mocks: MockServer;
};

export const test = base.extend<Fixtures>({
  startPage: async ({ page }, use) => use(new StartPage(page)),
  alternativesPage: async ({ page }, use) => use(new AlternativesPage(page)),
  companionPage: async ({ page }, use) => use(new CompanionPage(page)),
  mocks: async ({ page }, use) => use(new MockServer(page)),
});

export { expect } from "@playwright/test";
