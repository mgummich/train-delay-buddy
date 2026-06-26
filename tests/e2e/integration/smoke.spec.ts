/**
 * Smoke tests — hit real service endpoints with no browser.
 * These verify the full stack is wired correctly end-to-end.
 */
import { test, expect } from "@playwright/test";

const BACKEND = "http://localhost:8080";
const SIDECAR = "http://localhost:3000";
const NGINX = "http://localhost";

test("backend /health returns ok", async ({ request }) => {
  const res = await request.get(`${BACKEND}/health`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json() as { status: string };
  expect(body.status).toBe("ok");
});

test("backend /readyz all checks green", async ({ request }) => {
  type ReadyzBody = { status: string; checks: Record<string, string> };
  // Poll up to 30 s — the HAFAS sidecar can take a moment after startup.
  const deadline = Date.now() + 30_000;
  let body: ReadyzBody | null = null;
  while (Date.now() < deadline) {
    const res = await request.get(`${BACKEND}/readyz`);
    body = await res.json() as ReadyzBody;
    if (body?.checks?.hafas === "ok") break;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  expect(body!.checks.postgres).toBe("ok");
  expect(body!.checks.redis).toBe("ok");
  expect(body!.checks.hafas).toBe("ok");
  expect(body!.status).toBe("ok");
});

test("HAFAS sidecar /locations responds with real stations", async ({ request }) => {
  const res = await request.get(
    `${SIDECAR}/locations?query=Berlin&results=5&stops=true&addresses=false&poi=false`,
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.json() as Array<{ id: string; name: string; type: string }>;
  expect(Array.isArray(body)).toBeTruthy();
  expect(body.length).toBeGreaterThan(0);
  expect(body[0]).toHaveProperty("id");
  expect(body[0]).toHaveProperty("name");
  expect(body.some((s) => s.name.includes("Berlin"))).toBeTruthy();
});

/**
 * Regression: a slow hub-search (>20s) used to break the nginx → backend chain.
 * Backend `WriteTimeout: 20s` killed the response mid-write → nginx 502.
 * Nginx `proxy_read_timeout: 15s` aborted before search completed → frontend
 * saw a network error and displayed "Zug nicht gefunden für heute".
 *
 * This test queries a long-distance train through the nginx proxy with a long
 * client deadline. A 502/504 or unexpected truncation indicates the regression
 * has returned.
 *
 * Uses a real, daily train (IC 944) discovered by other tests to be reliable.
 * Skips when the train isn't running today (holidays, schedule changes).
 */
test("nginx → backend chain completes slow train search without 502/504", async ({ request }) => {
  test.setTimeout(120_000);

  const today = new Date().toISOString().split("T")[0]!;
  const res = await request.get(`${NGINX}/v1/trains/944?date=${today}`, {
    timeout: 90_000,
  });

  if (res.status() === 404) {
    test.skip(true, "IC 944 not running today (holiday/schedule change)");
  }
  if (res.status() === 503) {
    test.skip(true, "upstream HAFAS unhealthy — environmental, not regression");
  }

  expect.soft(res.status(), "nginx returned 502 — backend WriteTimeout regression?").not.toBe(502);
  expect.soft(res.status(), "nginx returned 504 — proxy_read_timeout regression?").not.toBe(504);
  expect(res.ok()).toBeTruthy();

  const body = await res.json() as { trainNumber: string; stops: Array<{ id: string }> };
  expect(body.trainNumber).toMatch(/IC ?944/);
  expect(body.stops.length).toBeGreaterThan(0);
});

test("backend /v1/stations proxies HAFAS and caches", async ({ request }) => {
  // First call — populates Redis cache
  const res1 = await request.get(`${BACKEND}/v1/stations?q=München`);
  expect(res1.ok()).toBeTruthy();
  const body1 = await res1.json() as { stations: Array<{ id: string; name: string }> };
  expect(body1.stations.length).toBeGreaterThan(0);
  expect(body1.stations.some((s) => s.name.includes("München"))).toBeTruthy();

  // Second call — served from Redis; verify shape is identical
  const res2 = await request.get(`${BACKEND}/v1/stations?q=München`);
  expect(res2.ok()).toBeTruthy();
  const body2 = await res2.json() as { stations: Array<{ id: string; name: string }> };
  expect(body2.stations.length).toBe(body1.stations.length);
  expect(body2.stations[0].id).toBe(body1.stations[0].id);
});
