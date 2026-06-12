import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_STATIONS } from '@/test/msw-handlers'
import { useStationSearch } from './useStationSearch'
import React from 'react'

const STATIONS_URL = 'http://localhost/v1/stations'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useStationSearch', () => {
  it('starts with empty results', () => {
    const { result } = renderHook(() => useStationSearch(), { wrapper })
    expect(result.current.stations).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('does not search on < 2 chars', async () => {
    const { result } = renderHook(() => useStationSearch(), { wrapper })
    act(() => { result.current.search('F') })
    await new Promise(r => setTimeout(r, 50))
    expect(result.current.isLoading).toBe(false)
  })

  it('returns stations after 200ms debounce', async () => {
    const { result } = renderHook(() => useStationSearch(), { wrapper })

    act(() => { result.current.search('Fra') })
    // No loading state before debounce fires
    expect(result.current.isLoading).toBe(false)

    // Wait for stations to appear (debounce + fetch)
    await waitFor(() => expect(result.current.stations).toHaveLength(2), { timeout: 1000 })

    expect(result.current.stations[0]?.name).toBe('Frankfurt (Main) Hbf')
  })

  it('clears results on empty string', async () => {
    const { result } = renderHook(() => useStationSearch(), { wrapper })
    act(() => { result.current.search('Frank') })
    await waitFor(() => expect(result.current.stations.length).toBeGreaterThan(0), { timeout: 1000 })
    act(() => { result.current.search('') })
    expect(result.current.stations).toEqual([])
  })
})
