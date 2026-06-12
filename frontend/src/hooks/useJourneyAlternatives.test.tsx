import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY } from '@/test/msw-handlers'
import { useJourneyAlternatives } from './useJourneyAlternatives'
import React from 'react'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

// Alternative schema: { journeyId, summary: JourneySummary, legs }
const ALT_DATA = {
  data: [
    {
      journeyId: 'jrn_alt01234567890a',
      summary: {
        ...DEFAULT_SUMMARY,
        timeGainVsOriginalMinutes: 18,
        eta: '2026-06-11T17:24:00Z',
        minTransferBufferMinutes: 3,
      },
      legs: [],
    },
    {
      journeyId: 'jrn_alt01234567890b',
      summary: {
        ...DEFAULT_SUMMARY,
        timeGainVsOriginalMinutes: 12,
        eta: '2026-06-11T17:30:00Z',
        minTransferBufferMinutes: 11,
      },
      legs: [],
    },
  ],
  totalCount: 2,
}

describe('useJourneyAlternatives', () => {
  it('fetches and returns alternatives list', async () => {
    server.use(http.get('/v1/journeys/:id/alternatives', () => HttpResponse.json(ALT_DATA)))
    const { result } = renderHook(() => useJourneyAlternatives(DEFAULT_JOURNEY_ID), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data?.data).toHaveLength(2)
    expect(result.current.data?.data[0]?.summary.timeGainVsOriginalMinutes).toBe(18)
  })

  it('returns empty list when no alternatives', async () => {
    server.use(
      http.get('/v1/journeys/:id/alternatives', () =>
        HttpResponse.json({ data: [], totalCount: 0 })
      )
    )
    const { result } = renderHook(() => useJourneyAlternatives(DEFAULT_JOURNEY_ID), { wrapper })
    await waitFor(() => expect(result.current.isFetched).toBe(true))
    expect(result.current.data?.data).toHaveLength(0)
  })
})
