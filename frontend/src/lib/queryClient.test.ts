import { describe, it, expect } from 'vitest'
import { queryClient, queryKeys } from './queryClient'

type RetryFn = (failureCount: number, error: unknown) => boolean
type RetryDelayFn = (attemptIndex: number, error: unknown) => number

describe('retry policy', () => {
  const retry = queryClient.getDefaultOptions().queries!.retry as RetryFn

  it('does not retry 4xx problem errors', () => {
    expect(retry(0, { status: 404, title: 'Not Found' })).toBe(false)
    expect(retry(0, { status: 400, title: 'Bad Request' })).toBe(false)
  })

  it('retries 429 with backoff', () => {
    expect(retry(0, { status: 429, title: 'Too Many Requests' })).toBe(true)
    expect(retry(3, { status: 429, title: 'Too Many Requests' })).toBe(false)
  })

  it('retries 5xx and unknown errors up to 3 attempts', () => {
    expect(retry(0, { status: 503 })).toBe(true)
    expect(retry(0, new Error('network'))).toBe(true)
    expect(retry(3, new Error('network'))).toBe(false)
  })

  it('reads status attached to plain Error objects', () => {
    expect(retry(0, Object.assign(new Error('HTTP 404'), { status: 404 }))).toBe(false)
    expect(retry(0, Object.assign(new Error('HTTP 503'), { status: 503 }))).toBe(true)
  })
})

describe('retry delay', () => {
  const retryDelay = queryClient.getDefaultOptions().queries!.retryDelay as RetryDelayFn

  it('backs off exponentially, capped at 30s, without Retry-After', () => {
    expect(retryDelay(0, new Error('network'))).toBe(1_000)
    expect(retryDelay(1, new Error('network'))).toBe(2_000)
    expect(retryDelay(10, new Error('network'))).toBe(30_000)
  })

  it('honours Retry-After per openapi.yaml: min(Retry-After * 2^n, 300s)', () => {
    const err = { status: 429, retryAfter: 30 }
    expect(retryDelay(0, err)).toBe(30_000)
    expect(retryDelay(1, err)).toBe(60_000)
    expect(retryDelay(9, err)).toBe(300_000)
  })

  it('ignores a non-numeric or zero Retry-After', () => {
    expect(retryDelay(0, { status: 429, retryAfter: undefined })).toBe(1_000)
    expect(retryDelay(0, { status: 429, retryAfter: 0 })).toBe(1_000)
  })
})

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
