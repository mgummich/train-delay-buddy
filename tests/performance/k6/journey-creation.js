/**
 * k6 performance test — Verspätungsbegleiter
 * Run: k6 run --env BASE_URL=http://localhost tests/performance/k6/journey-creation.js
 *
 * SLOs (from spec Section 9 Exit Criteria):
 *   POST /v1/journeys p95 < 10s
 *   GET /summary p95 < 200ms
 *   error rate < 1%
 *   ETag 304 rate > 50%
 */
import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Trend, Rate } from 'k6/metrics'

const BASE_URL = __ENV.BASE_URL || 'http://localhost'

// Custom metrics
const createLatency = new Trend('create_journey_latency_ms')
const pollLatency   = new Trend('poll_summary_latency_ms')
const etag304Rate   = new Rate('etag_304_rate')

export const options = {
  scenarios: {
    steady_load: {
      executor: 'constant-vus',
      vus: 10,
      duration: '1m',
    },
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { target: 50, duration: '30s' },
        { target: 50, duration: '30s' },
        { target: 0,  duration: '30s' },
      ],
      startTime: '1m30s',
    },
  },
  thresholds: {
    'create_journey_latency_ms': ['p(95)<10000'], // 10s SLO from spec
    'poll_summary_latency_ms':   ['p(95)<200'],   // fast poll path
    'http_req_failed':           ['rate<0.01'],   // <1% errors
    'etag_304_rate':             ['rate>0.50'],   // >50% polls should be 304
  },
}

// Pool of install IDs — simulates distinct devices
const INSTALL_IDS = Array.from({ length: 100 }, (_, i) =>
  `perf-test-install-${String(i).padStart(3, '0')}`,
)

function makeHeaders(installId, extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Install-Id': installId,
    ...extra,
  }
}

export default function () {
  const installId = INSTALL_IDS[__VU % INSTALL_IDS.length]
  const headers   = makeHeaders(installId)

  group('full journey lifecycle', function () {
    // ── 1. Validate train number ────────────────────────────────────────────
    const trainRes = http.get(
      `${BASE_URL}/v1/trains/ICE123?date=2026-06-11`,
      { headers, tags: { name: 'validate_train' } },
    )
    check(trainRes, {
      'GET /trains: 200 or 404': (r) => [200, 404].includes(r.status),
      'GET /trains: X-Request-Id present': (r) => !!r.headers['X-Request-Id'],
    })
    if (trainRes.status !== 200) return

    // ── 2. Station autocomplete ─────────────────────────────────────────────
    const stationRes = http.get(
      `${BASE_URL}/v1/stations?q=Frankfurt&limit=5`,
      { headers, tags: { name: 'station_autocomplete' } },
    )
    check(stationRes, {
      'GET /stations: 200': (r) => r.status === 200,
      'GET /stations: returns array': (r) => {
        const body = JSON.parse(r.body)
        return Array.isArray(body.stations)
      },
    })

    // ── 3. Create journey ───────────────────────────────────────────────────
    const journeyBody = JSON.stringify({
      trainNumber:    'ICE 123',
      destination:    '8000105',
      iAmOnThisTrain: true,
      filters: {
        dbOnly:       true,
        maxTransfers: null,
        safetyLevel:  'normal',
      },
    })

    const createRes = http.post(`${BASE_URL}/v1/journeys`, journeyBody, {
      headers,
      tags: { name: 'create_journey' },
    })
    createLatency.add(createRes.timings.duration)

    check(createRes, {
      'POST /journeys: 201':        (r) => r.status === 201,
      'POST /journeys: has journeyId': (r) => {
        try { return /^jrn_[0-9a-z]{12,26}$/.test(JSON.parse(r.body).journeyId) }
        catch { return false }
      },
      'POST /journeys: Location header': (r) => r.headers['Location']?.startsWith('/v1/journeys/'),
      'POST /journeys: X-Request-Id':    (r) => !!r.headers['X-Request-Id'],
    })

    if (createRes.status !== 201) return

    const { journeyId } = JSON.parse(createRes.body)

    // ── 4. Idempotency — same key same body → 200 not 201 ──────────────────
    const idempotencyKey = `perf-idem-${__VU}-${__ITER}`
    const idem1 = http.post(`${BASE_URL}/v1/journeys`, journeyBody, {
      headers: makeHeaders(installId, { 'Idempotency-Key': idempotencyKey }),
      tags: { name: 'idempotency_first' },
    })
    const idem2 = http.post(`${BASE_URL}/v1/journeys`, journeyBody, {
      headers: makeHeaders(installId, { 'Idempotency-Key': idempotencyKey }),
      tags: { name: 'idempotency_replay' },
    })
    check(idem2, {
      'idempotency replay returns 200': (r) => r.status === 200,
      'idempotency replay header set':  (r) => r.headers['Idempotency-Replayed'] === 'true',
    })

    // ── 5. Simulate polling (3 cycles) ──────────────────────────────────────
    let etag = null
    for (let i = 0; i < 3; i++) {
      const pollHeaders = etag
        ? makeHeaders(installId, { 'If-None-Match': etag })
        : makeHeaders(installId)

      const pollRes = http.get(
        `${BASE_URL}/v1/journeys/${journeyId}/summary`,
        { headers: pollHeaders, tags: { name: 'poll_summary' } },
      )
      pollLatency.add(pollRes.timings.duration)

      check(pollRes, {
        'GET /summary: 200 or 304':           (r) => [200, 304].includes(r.status),
        'GET /summary: Cache-Control header': (r) =>
          r.headers['Cache-Control']?.includes('no-cache'),
        'GET /summary: rate-limit headers':   (r) =>
          !!r.headers['X-RateLimit-Limit'],
      })

      etag304Rate.add(pollRes.status === 304)
      if (pollRes.status === 200) {
        etag = pollRes.headers['ETag']
      }

      sleep(0.3)
    }

    // ── 6. 304 on repeat with same ETag ─────────────────────────────────────
    if (etag) {
      const cachedRes = http.get(
        `${BASE_URL}/v1/journeys/${journeyId}/summary`,
        { headers: makeHeaders(installId, { 'If-None-Match': etag }), tags: { name: 'etag_304_check' } },
      )
      check(cachedRes, {
        'ETag unchanged → 304':          (r) => r.status === 304,
        '304 has no body':               (r) => r.body === '' || r.body === null,
        '304 still has rate-limit hdrs': (r) => !!r.headers['X-RateLimit-Limit'],
      })
    }

    // ── 7. Terminate journey ────────────────────────────────────────────────
    const deleteRes = http.del(
      `${BASE_URL}/v1/journeys/${journeyId}`,
      null,
      { headers, tags: { name: 'delete_journey' } },
    )
    check(deleteRes, {
      'DELETE /journeys: 204': (r) => r.status === 204,
    })

    // Second DELETE → 404 (not silently idempotent)
    const delete2 = http.del(
      `${BASE_URL}/v1/journeys/${journeyId}`,
      null,
      { headers, tags: { name: 'delete_journey_again' } },
    )
    check(delete2, {
      'second DELETE → 404': (r) => r.status === 404,
    })
  })

  sleep(0.5)
}
