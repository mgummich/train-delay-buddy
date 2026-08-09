import { describe, it, expect } from 'vitest'
import { formatTime, formatDateTime, minutesSince } from './datetime'
import { DST_SAMPLES } from '@/test/factories'

describe('formatTime', () => {
  it('formats UTC timestamp as Europe/Berlin time (summer, UTC+2)', () => {
    // 17:24 UTC = 19:24 Berlin (CEST)
    expect(formatTime(DST_SAMPLES.summerTime)).toBe('19:24')
  })

  it('formats UTC timestamp as Europe/Berlin time (winter, UTC+1)', () => {
    // 17:24 UTC = 18:24 Berlin (CET)
    expect(formatTime(DST_SAMPLES.winterTime)).toBe('18:24')
  })

  it('renders malformed input as dash instead of throwing', () => {
    expect(formatTime('not-a-date')).toBe('–')
    expect(formatDateTime('not-a-date')).toBe('–')
  })
})

describe('minutesSince', () => {
  it('returns positive minutes for past timestamps', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    expect(minutesSince(twoMinutesAgo)).toBeCloseTo(2, 0)
  })

  it('returns 0 for current timestamp', () => {
    const now = new Date().toISOString()
    expect(minutesSince(now)).toBeLessThanOrEqual(1)
  })
})
