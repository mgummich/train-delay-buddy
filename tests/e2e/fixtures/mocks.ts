import type { Page, Route } from "@playwright/test";

/** Default journey ID for tests that don't care about uniqueness. */
export const DEFAULT_JOURNEY_ID = "jrn_e2etest012345678901";

export type Summary = {
  eta: string;
  status: "ok" | "critical" | "failed";
  timeGainVsOriginalMinutes: number;
  timeGainVsCurrentRouteMinutes: number | null;
  minTransferBufferMinutes: number;
  criticalTransfer: boolean;
  alternativeAvailable: boolean;
  dataConfidence: "high" | "medium" | "low";
  nextStep: NextStep | null;
  dataFetchedAt: string;
  lastUpdatedAt: string;
};

type NextStep = {
  type: "ride" | "transfer";
  stationName: string;
  stationId: string;
  trainNumber: string | null;
  platform: string | null;
  departureTime: string | null;
  bufferMinutes: number | null;
};

const DEFAULT_NEXT_STEP: NextStep = {
  type: "ride",
  stationName: "Frankfurt (Main) Hbf",
  stationId: "8000105",
  trainNumber: "ICE 123",
  platform: "7",
  departureTime: null,
  bufferMinutes: null,
};

export const makeSummary = (overrides: Partial<Summary> = {}): Summary => ({
  eta: "2026-06-11T17:24:00Z",
  status: "ok",
  timeGainVsOriginalMinutes: 18,
  timeGainVsCurrentRouteMinutes: null,
  minTransferBufferMinutes: 9,
  criticalTransfer: false,
  alternativeAvailable: false,
  dataConfidence: "high",
  nextStep: DEFAULT_NEXT_STEP,
  dataFetchedAt: "2026-06-11T15:23:45Z",
  lastUpdatedAt: "2026-06-11T15:00:12Z",
  ...overrides,
});

export const makeTrain = () => ({
  trainNumber: "ICE 123",
  date: "2026-06-11",
  origin: { id: "8000261", name: "München Hbf" },
  destination: { id: "8011160", name: "Berlin Hbf" },
  stops: [
    { id: "8000261", name: "München Hbf" },
    { id: "8000105", name: "Frankfurt (Main) Hbf" },
    { id: "8011160", name: "Berlin Hbf" },
  ],
  status: "running",
});

export const makeStations = () => ({
  stations: [
    { id: "8000105", name: "Frankfurt (Main) Hbf" },
    { id: "8000104", name: "Frankfurt (Main) Süd" },
  ],
});

export const makeAlternative = (id = "jrn_alt001234567890ab") => ({
  journeyId: id,
  summary: makeSummary(),
  legs: [],
});

export const makeJourneyCreateResponse = (opts: {
  journeyId?: string;
  summary?: Partial<Summary>;
  plausibility?: { onTrainConfidence: "high" | "low"; reason: string | null };
} = {}) => ({
  journeyId: opts.journeyId ?? DEFAULT_JOURNEY_ID,
  plausibility: opts.plausibility ?? { onTrainConfidence: "high", reason: null },
  summary: makeSummary(opts.summary),
  alternatives: [makeAlternative()],
});

export type MockOptions = {
  journeyId?: string;
  summary?: Partial<Summary>;
  alternatives?: ReturnType<typeof makeAlternative>[];
  plausibility?: { onTrainConfidence: "high" | "low"; reason: string | null };
  /** Set true to make /v1/journeys/{id}/summary increment its ETag on each call. */
  rotatingETag?: boolean;
};

export class MockServer {
  private etagCounter = 0;
  constructor(private readonly page: Page) {}

  /** Install the full default route table. Call once per test. */
  async install(opts: MockOptions = {}): Promise<void> {
    const journeyId = opts.journeyId ?? DEFAULT_JOURNEY_ID;
    const summary = makeSummary(opts.summary);
    const alternatives = opts.alternatives ?? [makeAlternative()];

    await this.page.route("**/v1/trains/**", (r) => r.fulfill({ json: makeTrain() }));
    await this.page.route("**/v1/stations**", (r) => r.fulfill({ json: makeStations() }));

    await this.page.route("**/v1/journeys", this.routeJourneyCreate(journeyId, opts));

    await this.page.route(`**/v1/journeys/${journeyId}`, (route) => {
      if (route.request().method() === "DELETE") {
        route.fulfill({ status: 204 });
        return;
      }
      route.fulfill({
        json: { journeyId, summary, legs: [], stops: [] },
      });
    });

    await this.page.route(`**/v1/journeys/${journeyId}/summary`, (route) =>
      this.fulfillSummary(route, summary, opts.rotatingETag),
    );

    await this.page.route(`**/v1/journeys/${journeyId}/legs`, (r) =>
      r.fulfill({ json: { legs: [], stops: [] } }),
    );

    await this.page.route(`**/v1/journeys/${journeyId}/alternatives`, (r) =>
      r.fulfill({ json: { data: alternatives, totalCount: alternatives.length } }),
    );
  }

  /** Mock only the summary endpoint with a given override — useful for status-flip tests. */
  async overrideSummary(journeyId: string, summary: Summary): Promise<void> {
    await this.page.route(`**/v1/journeys/${journeyId}/summary`, (route) =>
      this.fulfillSummary(route, summary, false),
    );
  }

  /** Replace POST /v1/journeys with a low-confidence plausibility response. */
  async overrideJourneyCreatePlausibilityLow(journeyId: string): Promise<void> {
    await this.page.route(
      "**/v1/journeys",
      this.routeJourneyCreate(journeyId, {
        plausibility: { onTrainConfidence: "low", reason: "Train has passed destination" },
      }),
    );
  }

  private routeJourneyCreate(
    journeyId: string,
    opts: Pick<MockOptions, "summary" | "plausibility"> = {},
  ) {
    return (route: Route) => {
      if (route.request().method() !== "POST") { route.continue(); return; }
      route.fulfill({
        status: 201,
        json: makeJourneyCreateResponse({ journeyId, summary: opts.summary, plausibility: opts.plausibility }),
        headers: { Location: `/v1/journeys/${journeyId}` },
      });
    };
  }

  /** Force all journey lookups to 404. */
  async setAllJourneysNotFound(): Promise<void> {
    await this.page.route("**/v1/journeys/**", (r) =>
      r.fulfill({
        status: 404,
        json: { type: "urn:vbb:error:journey-not-found", title: "Not Found", status: 404 },
      }),
    );
  }

  /** Abort all journey traffic — simulates total network failure. */
  async abortAllJourneys(): Promise<void> {
    await this.page.route("**/v1/journeys/**", (r) => r.abort("failed"));
  }

  private fulfillSummary(route: Route, summary: Summary, rotating?: boolean) {
    const tag = rotating ? `"jrn:epoch:${++this.etagCounter}"` : `"jrn:epoch:1"`;
    route.fulfill({ json: summary, headers: { ETag: tag } });
  }
}
