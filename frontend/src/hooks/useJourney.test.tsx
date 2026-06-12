import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY } from '@/test/msw-handlers'
import { buildCriticalSummary } from '@/test/factories'
import { useJourney } from './useJourney'
import React from 'react'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useJourney', () => {
  it('fetches summary and returns data', async () => {
    const { result } = renderHook(() => useJourney(DEFAULT_JOURNEY_ID), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data?.status).toBe('ok')
  })

  it('sends If-None-Match header on subsequent polls when etag is set', async () => {
    let capturedHeader: string | null = null
    server.use(
      http.get('/v1/journeys/:id/summary', ({ request }) => {
        capturedHeader = request.headers.get('If-None-Match')
        return HttpResponse.json(DEFAULT_SUMMARY, {
          headers: { ETag: '"test:epoch:1"' },
        })
      }),
    )
    const { result } = renderHook(
      () => useJourney(DEFAULT_JOURNEY_ID, '"test:epoch:1"'),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isFetched).toBe(true))
    expect(capturedHeader).toBe('"test:epoch:1"')
  })

  it('returns refetchInterval of 10000 when status is critical', async () => {
    server.use(
      http.get('/v1/journeys/:id/summary', () =>
        HttpResponse.json(buildCriticalSummary(), {
          headers: { ETag: '"test:epoch:2"' },
        }),
      ),
    )
    const { result } = renderHook(() => useJourney(DEFAULT_JOURNEY_ID), { wrapper })
    await waitFor(() => expect(result.current.data?.status).toBe('critical'))
    expect(result.current.data?.minTransferBufferMinutes).toBeLessThan(5)
  })
})
