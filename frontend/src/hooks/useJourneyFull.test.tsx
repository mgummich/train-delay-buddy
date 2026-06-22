import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'
import { DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY, MSW_ERRORS } from '@/test/msw-handlers'
import { useJourneyFull, journeyFullQuery } from './useJourneyFull'
import React from 'react'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const FULL_JOURNEY = {
  journeyId: DEFAULT_JOURNEY_ID,
  summary: DEFAULT_SUMMARY,
  legs: [],
  stops: [],
}

describe('useJourneyFull', () => {
  it('fetches and returns journey data', async () => {
    server.use(http.get('/v1/journeys/:id', () => HttpResponse.json(FULL_JOURNEY)))
    const { result } = renderHook(() => useJourneyFull(DEFAULT_JOURNEY_ID), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data?.journeyId).toBe(DEFAULT_JOURNEY_ID)
  })

  it('returns error state on 404', async () => {
    server.use(http.get('/v1/journeys/:id', () => MSW_ERRORS.journeyNotFound()))
    const { result } = renderHook(() => useJourneyFull('jrn_notfound0000000000'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('journeyFullQuery builds correct key', () => {
    const q = journeyFullQuery('jrn_abc')
    expect(q.queryKey).toEqual(['journey', 'full', 'jrn_abc'])
  })
})
