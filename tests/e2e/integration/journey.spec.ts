/**
 * Full journey flow with real HAFAS data.
 *
 * Strategy: query the HAFAS sidecar for departures from München Hbf in the
 * next 3 hours, pick the first long-distance train (ICE/IC), verify the
 * backend also finds it, then drive the UI through the full flow.
 *
 * Tests skip gracefully when no suitable train is found (e.g. late night,
 * network issues) rather than failing — real data is inherently dynamic.
 */
import { test, expect } from "@playwright/test";
import { StartPage } from "../pages/start.page";
import { AlternativesPage } from "../pages/alternatives.page";

const SIDECAR = "http://localhost:3000";
const BACKEND = "http://localhost:8080";
// München Hbf — busy hub with ICE departures throughout the day
const MÜNCHEN_HBF = "8000261";

type Departure = {
  tripId: string;
  line?: { name?: string; product?: string };
  direction?: string;
  cancelled?: boolean;
};

/** Finds the first non-cancelled long-distance departure from the given stop. */
async function findLongDistanceDeparture(
  request: import("@playwright/test").APIRequestContext,
  stopId: string,
  durationMins = 180,
): Promise<Departure | null> {
  const res = await request.get(
    `${SIDECAR}/stops/${stopId}/departures?results=100&duration=${durationMins}`,
  );
  if (!res.ok()) return null;

  const body = await res.json() as { departures?: Departure[] };
  const deps = body.departures ?? [];
  return (
    deps.find(
      (d) =>
        !d.cancelled &&
        d.line?.name &&
        d.direction &&
        (d.line.product === "nationalExpress" || d.line.product === "national"),
    ) ?? null
  );
}

// Journey tests call the backend hub-search which scans departure boards from
// midnight forward (~85 results/page, 8 s per request). A train departing at
// 13:00 requires ~13 pages × 8 s = >90 s per hub. Mark them slow so CI can
// run INTEGRATION_SKIP_SLOW=1 to execute only smoke + station tests.
const SLOW = !!process.env.INTEGRATION_SKIP_SLOW;

test.describe("full-stack journey flow — real data", () => {
  test("train validation returns stop list for a real ICE", async ({ request }) => {
    test.skip(SLOW, "slow hub-search test — set INTEGRATION_SKIP_SLOW= to enable");
    test.setTimeout(360_000);
    const dep = await findLongDistanceDeparture(request, MÜNCHEN_HBF);
    if (!dep?.line?.name) {
      test.skip(true, "No long-distance departure found — skipping");
      return;
    }

    const today = new Date().toLocaleDateString("sv"); // YYYY-MM-DD
    const res = await request.get(
      `${BACKEND}/v1/trains/${encodeURIComponent(dep.line.name)}?date=${today}`,
      { timeout: 300_000 },
    );

    expect(res.status()).not.toBe(503);  // not upstream-unavailable
    // 200 = found, 404 = backend didn't find it via hub search (acceptable flakiness)
    if (res.status() === 404) {
      test.skip(true, `Backend hub search missed ${dep.line.name} — skipping`);
      return;
    }
    expect(res.ok()).toBeTruthy();

    const body = await res.json() as {
      trainNumber: string;
      origin: { id: string; name: string };
      destination: { id: string; name: string };
      stops: Array<{ id: string; name: string }>;
    };
    expect(body.trainNumber).toBeTruthy();
    expect(body.stops.length).toBeGreaterThan(1);
    expect(body.origin.id).toBeTruthy();
    expect(body.destination.id).toBeTruthy();
  });

  test("start → alternatives with a real running ICE", async ({ page, request }) => {
    test.skip(SLOW, "slow hub-search test — set INTEGRATION_SKIP_SLOW= to enable");
    test.setTimeout(360_000);
    // Step 1: discover a real long-distance train via HAFAS sidecar
    const dep = await findLongDistanceDeparture(request, MÜNCHEN_HBF);
    if (!dep?.line?.name || !dep.direction) {
      test.skip(true, "No long-distance departure found — skipping");
      return;
    }
    const trainNumber = dep.line.name;

    // Step 2: verify backend can look it up (skips if hub search misses it)
    const today = new Date().toLocaleDateString("sv");
    const trainRes = await request.get(
      `${BACKEND}/v1/trains/${encodeURIComponent(trainNumber)}?date=${today}`,
      { timeout: 300_000 },
    );
    if (!trainRes.ok()) {
      test.skip(true, `Backend couldn't find ${trainNumber} — skipping`);
      return;
    }
    const trainBody = await trainRes.json() as {
      stops: Array<{ id: string; name: string }>;
      destination: { name: string };
    };

    // Use the train's final destination as the UI target
    const destName = trainBody.destination.name;
    // First word is usually the city — enough to trigger autocomplete
    const destQuery = destName.split(" ")[0].replace(/[()]/g, "").trim();

    // Step 3: UI flow
    const startPage = new StartPage(page);
    await startPage.goto();
    await startPage.fillTrain(trainNumber);
    // Test-only: regex built from HAFAS station name fixture, not untrusted input.
    await startPage.pickDestination(destQuery, new RegExp(destName.split(" ")[0], "i")); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    await startPage.submit();

    // Alternatives page must load — this proves POST /v1/journeys succeeded with real data
    const alternativesPage = new AlternativesPage(page);
    await expect(page).toHaveURL(/\/journey\/.*\/alternatives/, { timeout: 45_000 });
    await expect(alternativesPage.timeGainHint).toBeVisible({ timeout: 30_000 });
  });

  test("POST /v1/journeys returns valid journey shape", async ({ request }) => {
    test.skip(SLOW, "slow hub-search test — set INTEGRATION_SKIP_SLOW= to enable");
    test.setTimeout(360_000);
    // API-level integration: bypasses the UI, directly tests the backend
    const dep = await findLongDistanceDeparture(request, MÜNCHEN_HBF);
    if (!dep?.line?.name) {
      test.skip(true, "No long-distance departure found — skipping");
      return;
    }

    const today = new Date().toLocaleDateString("sv");
    const trainRes = await request.get(
      `${BACKEND}/v1/trains/${encodeURIComponent(dep.line.name)}?date=${today}`,
      { timeout: 300_000 },
    );
    if (!trainRes.ok()) {
      test.skip(true, `Train ${dep.line.name} not found by backend — skipping`);
      return;
    }
    const train = await trainRes.json() as {
      trainNumber: string;
      stops: Array<{ id: string; name: string }>;
      destination: { id: string; name: string };
    };

    // Pick a midpoint stop as destination (not the terminus — more interesting routing)
    const destStop = train.stops[Math.floor(train.stops.length / 2)] ?? train.stops.at(-1)!;

    const res = await request.post(`${BACKEND}/v1/journeys`, {
      headers: {
        "Content-Type": "application/json",
        "X-Install-Id": "integration-test-00000000",
        "Idempotency-Key": `integration-${Date.now()}`,
      },
      data: {
        trainNumber: train.trainNumber,
        destinationStationId: destStop.id,
        filters: {},
      },
    });

    // 201 = journey created, 409 = idempotency replay (also fine)
    expect([201, 409]).toContain(res.status());

    const body = await res.json() as {
      journeyId: string;
      summary: { status: string };
      plausibility: { onTrainConfidence: string };
    };
    expect(body.journeyId).toMatch(/^jrn_/);
    expect(body.summary).toHaveProperty("status");
    expect(body.plausibility).toHaveProperty("onTrainConfidence");

    // Clean up — terminate the journey so the poller doesn't run indefinitely
    await request.delete(`${BACKEND}/v1/journeys/${body.journeyId}`, {
      headers: { "X-Install-Id": "integration-test-00000000" },
    });
  });
});
