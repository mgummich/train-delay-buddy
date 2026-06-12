import { describe, it, expect } from 'vitest'
import { queryKeys } from './queryClient'

describe('queryKeys', () => {
  it('journeyFull key includes id', () => {
    expect(queryKeys.journeyFull('jrn_abc')).toEqual(['journey', 'full', 'jrn_abc'])
  })

  it('journeySummary key differs from journeyFull', () => {
    const full = queryKeys.journeyFull('jrn_abc')
    const summary = queryKeys.journeySummary('jrn_abc')
    expect(full).not.toEqual(summary)
  })

  it('stations key includes query string', () => {
    expect(queryKeys.stations('Frank')).toEqual(['stations', 'Frank'])
  })
})
