/**
 * MSW request handlers — generated shape matches backend/openapi.yaml
 *
 * Default handlers return minimal valid responses.
 * Override in individual tests with server.use(http.get(...)).
 *
 * Usage:
 *   import { server } from '@/test/msw-handlers'
 *   server.use(http.get('/v1/journeys/:id/summary', () => HttpResponse.json(myMock)))
 */
import { http, HttpResponse, passthrough } from 'msw'
import { setupServer } from 'msw/node'
import type { paths } from '@/api/types.gen'

// ── Default mock data ────────────────────────────────────────────────────────

export const DEFAULT_JOURNEY_ID = 'jrn_testdefault01234567'

export const DEFAULT_SUMMARY = {
  eta: '2026-06-11T17:24:00Z',
  status: 'ok' as const,
  timeGainVsOriginalMinutes: 18,
  timeGainVsCurrentRouteMinutes: null,
  minTransferBufferMinutes: 9,
  criticalTransfer: false,
  alternativeAvailable: false,
  dataConfidence: 'high' as const,
  nextStep: null,
  dataFetchedAt: '2026-06-11T15:23:45Z',
  lastUpdatedAt: '2026-06-11T15:00:12Z',
} satisfies paths['/journeys/{id}/summary']['get']['responses']['200']['content']['application/json']

export const DEFAULT_TRAIN = {
  trainNumber: 'ICE 123',
  date: '2026-06-11',
  origin: { id: '8000261', name: 'München Hbf' },
  destination: { id: '8011160', name: 'Berlin Hbf' },
  stops: [],
  status: 'running' as const,
}

export const DEFAULT_STATIONS = {
  stations: [
    { id: '8000105', name: 'Frankfurt (Main) Hbf' },
    { id: '8000104', name: 'Frankfurt (Main) Süd' },
  ],
}

export const DEFAULT_JOURNEY_RESPONSE = {
  journeyId: DEFAULT_JOURNEY_ID,
  plausibility: { onTrainConfidence: 'high' as const, reason: null },
  summary: DEFAULT_SUMMARY,
  alternatives: [],
}

// MSW v2 in Node.js requires absolute URLs — relative paths are not resolved.
// These must match VITE_API_BASE_URL (http://localhost/v1) set in vitest.config.ts.
const BASE = 'http://localhost/v1'

// ── Default handlers ─────────────────────────────────────────────────────────

export const defaultHandlers = [
  // Train validation
  http.get(`${BASE}/trains/:number`, () => HttpResponse.json(DEFAULT_TRAIN)),

  // Station autocomplete
  http.get(`${BASE}/stations`, () => HttpResponse.json(DEFAULT_STATIONS)),

  // Journey creation
  http.post(`${BASE}/journeys`, () =>
    HttpResponse.json(DEFAULT_JOURNEY_RESPONSE, {
      status: 201,
      headers: { Location: `/v1/journeys/${DEFAULT_JOURNEY_ID}` },
    })
  ),

  // Full journey
  http.get(`${BASE}/journeys/:id`, () =>
    HttpResponse.json({
      journeyId: DEFAULT_JOURNEY_ID,
      summary: DEFAULT_SUMMARY,
      legs: [],
      stops: [],
    })
  ),

  // Summary polling
  http.get(`${BASE}/journeys/:id/summary`, () =>
    HttpResponse.json(DEFAULT_SUMMARY, {
      headers: { ETag: `"${DEFAULT_JOURNEY_ID}:epoch:1"` },
    })
  ),

  // Legs
  http.get(`${BASE}/journeys/:id/legs`, () => HttpResponse.json({ legs: [], stops: [] })),

  // Alternatives
  http.get(`${BASE}/journeys/:id/alternatives`, () =>
    HttpResponse.json({ data: [], totalCount: 0 })
  ),

  // Trigger recompute
  http.post(`${BASE}/journeys/:id/alternatives`, ({ params }) =>
    HttpResponse.json(
      {
        status: 'computing',
        pollPath: `/v1/journeys/${params.id}/alternatives`,
      },
      { status: 202 }
    )
  ),

  // Delete journey
  http.delete(`${BASE}/journeys/:id`, () => new HttpResponse(null, { status: 204 })),

  // Health (no /v1 prefix)
  http.get('http://localhost/health', () => HttpResponse.json({ status: 'ok' })),
  http.get('http://localhost/readyz', () =>
    HttpResponse.json({ status: 'ok', checks: { redis: 'ok', postgres: 'ok', hafas: 'ok' } })
  ),
]

// ── MSW server instance ──────────────────────────────────────────────────────

export const server = setupServer(...defaultHandlers)

// ── Error response helpers ───────────────────────────────────────────────────

export function problemResponse(slug: string, status: number, detail: string) {
  return HttpResponse.json(
    { type: `urn:vbb:error:${slug}`, title: slug, status, detail },
    { status, headers: { 'Content-Type': 'application/problem+json' } }
  )
}

export const MSW_ERRORS = {
  trainNotFound: () => problemResponse('train-not-found', 404, 'Train not found.'),
  journeyNotFound: () => problemResponse('journey-not-found', 404, 'Journey not found.'),
  validationError: (errors: { field: string; message: string }[]) =>
    HttpResponse.json(
      {
        type: 'urn:vbb:error:validation-error',
        title: 'Validation Error',
        status: 422,
        detail: 'Invalid fields.',
        errors,
      },
      { status: 422, headers: { 'Content-Type': 'application/problem+json' } }
    ),
  upstreamUnavailable: () => problemResponse('upstream-unavailable', 503, 'HAFAS unreachable.'),
  rateLimitExceeded: () =>
    HttpResponse.json(
      { type: 'urn:vbb:error:rate-limit-exceeded', title: 'Rate Limit', status: 429 },
      { status: 429, headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '10' } }
    ),
  internalError: () => problemResponse('internal-error', 500, 'Unexpected error.'),
}
