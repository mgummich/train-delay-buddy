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

  private readonly _apiPredicate = (url: URL) =>
    /\/(journeys|trains|stations)/.test(url.pathname);
  private readonly _abortHandler = async (r: Route) => r.abort("failed");

  /** Abort all API traffic so the app sees a network drop.
   * Call alongside context.setOffline() — Playwright route handlers bypass browser offline. */
  async setOffline(offline: boolean): Promise<void> {
    if (offline) {
      await this.page.route(this._apiPredicate, this._abortHandler);
    } else {
      await this.page.unroute(this._apiPredicate, this._abortHandler);
    }
  }

  /** Install the full default route table. Call once per test. */
  async install(opts: MockOptions = {}): Promise<void> {
    const journeyId = opts.journeyId ?? DEFAULT_JOURNEY_ID;
    const summary = makeSummary(opts.summary);
    const alternatives = opts.alternatives ?? [makeAlternative()];

    await this.page.route("**/trains/**", async (r) => r.fulfill({ json: makeTrain() }));
    await this.page.route("**/stations**", async (r) => r.fulfill({ json: makeStations() }));

    await this.page.route("**/journeys", this.routeJourneyCreate(journeyId, opts));

    await this.page.route(`**/journeys/${journeyId}`, async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({
        json: { journeyId, summary, legs: [], stops: [] },
      });
    });

    await this.page.route(`**/journeys/${journeyId}/summary`, (route) =>
      this.fulfillSummary(route, summary, opts.rotatingETag),
    );

    await this.page.route(`**/journeys/${journeyId}/legs`, async (r) =>
      r.fulfill({ json: { legs: [], stops: [] } }),
    );

    await this.page.route(`**/journeys/${journeyId}/alternatives`, async (r) =>
      r.fulfill({ json: { data: alternatives, totalCount: alternatives.length } }),
    );

    // Mock routes for each alternative journey so companion loads after selection.
    for (const alt of alternatives) {
      const altSummary = alt.summary as Summary;
      await this.page.route(`**/journeys/${alt.journeyId}`, async (route) => {
        if (route.request().method() === "DELETE") { await route.fulfill({ status: 204 }); return; }
        await route.fulfill({ json: { journeyId: alt.journeyId, summary: altSummary, legs: [], stops: [] } });
      });
      await this.page.route(`**/journeys/${alt.journeyId}/summary`, (route) =>
        this.fulfillSummary(route, altSummary, false),
      );
      await this.page.route(`**/journeys/${alt.journeyId}/legs`, async (r) =>
        r.fulfill({ json: { legs: [], stops: [] } }),
      );
    }
  }

  /** Mock only the summary endpoint with a given override — useful for status-flip tests. */
  async overrideSummary(journeyId: string, summary: Summary): Promise<void> {
    await this.page.route(`**/journeys/${journeyId}/summary`, async (route) =>
      this.fulfillSummary(route, summary, false),
    );
  }

  /** Replace POST /v1/journeys with a low-confidence plausibility response. */
  async overrideJourneyCreatePlausibilityLow(journeyId: string): Promise<void> {
    await this.page.route(
      "**/journeys",
      this.routeJourneyCreate(journeyId, {
        plausibility: { onTrainConfidence: "low", reason: "Train has passed destination" },
      }),
    );
  }

  private routeJourneyCreate(
    journeyId: string,
    opts: Pick<MockOptions, "summary" | "plausibility"> = {},
  ) {
    return async (route: Route) => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      await route.fulfill({
        status: 201,
        json: makeJourneyCreateResponse({ journeyId, summary: opts.summary, plausibility: opts.plausibility }),
        headers: { Location: `/v1/journeys/${journeyId}` },
      });
    };
  }

  /** Force all journey lookups to 404. */
  async setAllJourneysNotFound(): Promise<void> {
    await this.page.route("**/journeys/**", async (r) =>
      r.fulfill({
        status: 404,
        json: { type: "urn:vbb:error:journey-not-found", title: "Not Found", status: 404 },
      }),
    );
  }

  /** Abort all journey traffic — simulates total network failure. */
  async abortAllJourneys(): Promise<void> {
    await this.page.route("**/journeys/**", async (r) => r.abort("failed"));
  }

  /** Make GET /trains/** return 404 — simulates unknown train number. */
  async setTrainNotFound(): Promise<void> {
    await this.page.route("**/trains/**", async (r) =>
      r.fulfill({ status: 404, json: { type: "urn:vbb:error:not-found", status: 404 } }),
    );
  }

  /** Make GET /stations return 503 — simulates upstream station search failure. */
  async setStationsError(): Promise<void> {
    await this.page.route("**/stations**", async (r) =>
      r.fulfill({ status: 503, json: { type: "urn:vbb:error:upstream", status: 503 } }),
    );
  }

  private async fulfillSummary(route: Route, summary: Summary, rotating?: boolean) {
    const tag = rotating ? `"jrn:epoch:${++this.etagCounter}"` : `"jrn:epoch:1"`;
    // Always return current dataFetchedAt so fresh polls look fresh (stale indicator disappears when online).
    const now = new Date().toISOString();
    await route.fulfill({ json: { ...summary, dataFetchedAt: now, lastUpdatedAt: now }, headers: { ETag: tag } });
  }
}
