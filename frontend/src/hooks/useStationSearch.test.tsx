import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useStationSearch } from './useStationSearch'


describe('useStationSearch', () => {
  it('starts with empty results', () => {
    const { result } = renderHook(() => useStationSearch())
    expect(result.current.stations).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('does not search on < 2 chars', () => {
    const { result } = renderHook(() => useStationSearch())
    act(() => { result.current.search('F') })
    expect(result.current.isLoading).toBe(false)
  })

  it('returns stations after 200ms debounce', async () => {
    const { result } = renderHook(() => useStationSearch())

    act(() => { result.current.search('Fra') })
    expect(result.current.isLoading).toBe(false)

    await waitFor(() => expect(result.current.stations).toHaveLength(2), { timeout: 1000 })
    expect(result.current.stations[0]?.name).toBe('Frankfurt (Main) Hbf')
  })

  it('clears results on empty string', async () => {
    const { result } = renderHook(() => useStationSearch())
    act(() => { result.current.search('Frank') })
    await waitFor(() => expect(result.current.stations.length).toBeGreaterThan(0), { timeout: 1000 })
    act(() => { result.current.search('') })
    expect(result.current.stations).toEqual([])
  })

  it('clear() resets loading state', async () => {
    const { result } = renderHook(() => useStationSearch())
    act(() => { result.current.search('Frank') })
    await waitFor(() => expect(result.current.stations.length).toBeGreaterThan(0), { timeout: 1000 })
    act(() => { result.current.clear() })
    expect(result.current.stations).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })
})
