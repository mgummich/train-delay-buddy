import { describe, it, expect } from 'vitest'
import { apiError, isDeleteNotFound } from './client'

function res(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers })
}

describe('apiError', () => {
  it('stamps status and Retry-After onto the parsed Problem body', () => {
    const problem = { type: 'urn:vbb:error:rate-limit-exceeded', status: 429 }
    const thrown = apiError(res(429, { 'Retry-After': '30' }), problem)
    expect(thrown).toMatchObject({ status: 429, retryAfter: 30 })
  })

  it('synthesises an Error when the body was not parseable Problem JSON', () => {
    const thrown = apiError(res(502)) as Error & { status: number; retryAfter?: number }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toBe('HTTP 502')
    expect(thrown.status).toBe(502)
    expect(thrown.retryAfter).toBeUndefined()
  })

  it('leaves retryAfter undefined for a missing or non-numeric header', () => {
    expect(apiError(res(503))).toMatchObject({ retryAfter: undefined })
    // HTTP-date form of Retry-After is not supported; must not become NaN.
    expect(apiError(res(503, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }))).toMatchObject({
      retryAfter: undefined,
    })
  })
})

describe('isDeleteNotFound', () => {
  it('matches 404 on the journey DELETE path only', () => {
    expect(isDeleteNotFound(404, 'https://x/v1/journeys/jrn_abc123abc123')).toBe(true)
    expect(isDeleteNotFound(404, 'https://x/v1/journeys/jrn_abc123abc123/summary')).toBe(false)
    expect(isDeleteNotFound(500, 'https://x/v1/journeys/jrn_abc123abc123')).toBe(false)
  })
})
