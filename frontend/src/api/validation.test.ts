import { describe, it, expect } from 'vitest'
import { journeyIdSchema, journeySummarySchema, safeParse } from './validation'

describe('journeyIdSchema', () => {
  it('accepts valid journeyId', () => {
    expect(journeyIdSchema.safeParse('jrn_01j2k3m4n5p6').success).toBe(true)
  })
  it('rejects short id', () => {
    expect(journeyIdSchema.safeParse('jrn_short').success).toBe(false)
  })
  it('rejects wrong prefix', () => {
    expect(journeyIdSchema.safeParse('bad_01j2k3m4n5p6q7r8').success).toBe(false)
  })
})

describe('safeParse', () => {
  it('returns valid data unchanged', () => {
    const id = 'jrn_01j2k3m4n5p6'
    expect(safeParse(journeyIdSchema, id)).toBe(id)
  })
  it('returns raw data on schema failure without throwing', () => {
    // safeParse must never throw — live journeys must not crash
    expect(() => safeParse(journeyIdSchema, 12345)).not.toThrow()
  })
})

describe('journeySummarySchema', () => {
  it('accepts minimal valid summary', () => {
    const summary = {
      eta: '2026-06-11T17:24:00Z',
      status: 'ok',
      timeGainVsOriginalMinutes: 18,
      timeGainVsCurrentRouteMinutes: null,
      minTransferBufferMinutes: 9,
      criticalTransfer: false,
      alternativeAvailable: false,
      dataConfidence: 'high',
      nextStep: null,
      dataFetchedAt: '2026-06-11T15:23:45Z',
      lastUpdatedAt: '2026-06-11T15:00:12Z',
    }
    expect(journeySummarySchema.safeParse(summary).success).toBe(true)
  })
  it('rejects unknown status value', () => {
    const bad = { status: 'pending' }
    expect(journeySummarySchema.safeParse(bad).success).toBe(false)
  })
})
