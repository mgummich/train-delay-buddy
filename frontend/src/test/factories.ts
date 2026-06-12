/**
 * Test data factories — build valid API response shapes
 * All fields default to valid values; override what you need.
 *
 * Usage:
 *   const summary = buildSummary({ status: 'critical', minTransferBufferMinutes: 2 })
 *   const journey = buildJourney({ summary, alternatives: [buildAlternative()] })
 */
import type { paths } from '@/api/types.gen'

type Summary =
  paths['/journeys/{id}/summary']['get']['responses']['200']['content']['application/json']
type Leg = NonNullable<
  paths['/journeys/{id}/legs']['get']['responses']['200']['content']['application/json']['legs']
>[number]
type Stop = NonNullable<
  paths['/journeys/{id}/legs']['get']['responses']['200']['content']['application/json']['stops']
>[number]
type NextStep = NonNullable<Summary['nextStep']>
type Station = { id: string; name: string }

// ── Counters for unique IDs ──────────────────────────────────────────────────
let seq = 1
const next = () => String(seq++).padStart(6, '0')

// ── Builders ─────────────────────────────────────────────────────────────────

export function buildSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    eta: '2026-06-11T17:24:00Z',
    status: 'ok',
    timeGainVsOriginalMinutes: 18,
    timeGainVsCurrentRouteMinutes: null,
    minTransferBufferMinutes: 9,
    criticalTransfer: false,
    alternativeAvailable: false,
    dataConfidence: 'high',
    nextStep: null,
    dataFetchedAt: '2026-06-11T15:00:00Z',
    lastUpdatedAt: '2026-06-11T15:00:00Z',
    ...overrides,
  }
}

export function buildNextStep(overrides: Partial<NextStep> = {}): NextStep {
  return {
    type: 'transfer',
    stationName: 'Kassel Hbf',
    stationId: '8000294',
    trainNumber: 'RE 4321',
    platform: '5',
    departureTime: '2026-06-11T16:57:00Z',
    bufferMinutes: 9,
    ...overrides,
  }
}

export function buildLeg(overrides: Partial<Leg> = {}): Leg {
  const id = next()
  return {
    legId: `leg_${id}`,
    vehicleNumber: 'ICE 123',
    lineName: 'ICE 123',
    operator: 'DB Fernverkehr AG',
    departureTimePlanned: '2026-06-11T15:00:00Z',
    departureTimeActual: '2026-06-11T15:02:00Z',
    arrivalTimePlanned: '2026-06-11T17:00:00Z',
    arrivalTimeActual: '2026-06-11T17:05:00Z',
    delayMinutes: 5,
    platformPlanned: '7',
    platformActual: '7',
    status: 'running',
    isWalkingSegment: false,
    ...overrides,
  }
}

export function buildStop(overrides: Partial<Stop> = {}): Stop {
  return {
    stationId: '8000105',
    stationName: 'Frankfurt (Main) Hbf',
    arrivalTimePlanned: '2026-06-11T16:00:00Z',
    arrivalTimeActual: '2026-06-11T16:02:00Z',
    departureTimePlanned: '2026-06-11T16:05:00Z',
    departureTimeActual: '2026-06-11T16:07:00Z',
    delayMinutes: 2,
    platformPlanned: '4',
    platformActual: '4',
    transferBufferMinutes: null,
    ...overrides,
  }
}

export function buildStation(overrides: Partial<Station> = {}): Station {
  return {
    id: `800${next()}`,
    name: `Station ${next()}`,
    ...overrides,
  }
}

export function buildJourneyId(): string {
  return `jrn_test${next().padStart(14, '0')}`
}

// ── Critical-status helpers ───────────────────────────────────────────────────

export function buildCriticalSummary(overrides: Partial<Summary> = {}): Summary {
  return buildSummary({
    status: 'critical',
    minTransferBufferMinutes: 2,
    criticalTransfer: true,
    alternativeAvailable: true,
    nextStep: buildNextStep({ bufferMinutes: 2 }),
    ...overrides,
  })
}

export function buildFailedSummary(overrides: Partial<Summary> = {}): Summary {
  return buildSummary({
    status: 'failed',
    minTransferBufferMinutes: null,
    criticalTransfer: true,
    alternativeAvailable: false,
    nextStep: null,
    ...overrides,
  })
}

// ── DST test helpers ──────────────────────────────────────────────────────────
// Useful for datetime.ts tests

export const DST_SAMPLES = {
  summerTime: '2026-06-11T17:24:00Z', // UTC+2 (CEST) → 19:24 Berlin
  winterTime: '2026-01-11T17:24:00Z', // UTC+1 (CET)  → 18:24 Berlin
  springForwardBefore: '2026-03-29T00:59:00Z', // → 01:59 Berlin
  springForwardAfter: '2026-03-29T01:00:00Z', // → 03:00 Berlin (gap)
  fallBackBefore: '2026-10-25T00:59:00Z', // → 02:59 Berlin
  fallBackAmbiguous: '2026-10-25T01:30:00Z', // → 02:30 Berlin (twice)
}
