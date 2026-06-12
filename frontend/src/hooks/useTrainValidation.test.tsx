import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { server, MSW_ERRORS } from '@/test/msw-handlers'
import { useTrainValidation } from './useTrainValidation'
import React from 'react'

const TRAINS_URL = 'http://localhost/v1/trains/:number'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useTrainValidation', () => {
  it('starts with no error', () => {
    const { result } = renderHook(() => useTrainValidation(), { wrapper })
    expect(result.current.error).toBeNull()
    expect(result.current.isValidating).toBe(false)
  })

  it('sets error when train not found', async () => {
    server.use(http.get(TRAINS_URL, () => MSW_ERRORS.trainNotFound()))
    const { result } = renderHook(() => useTrainValidation(), { wrapper })

    act(() => { result.current.validate('ICE999') })

    await waitFor(() => expect(result.current.isValidating).toBe(false))
    expect(result.current.error).toBe('Zug nicht gefunden für heute')
  })

  it('clears error on valid train', async () => {
    const { result } = renderHook(() => useTrainValidation(), { wrapper })

    act(() => { result.current.validate('ICE 123') })

    await waitFor(() => expect(result.current.isValidating).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.trainData?.trainNumber).toBe('ICE 123')
  })

  it('does nothing on empty input', async () => {
    const { result } = renderHook(() => useTrainValidation(), { wrapper })
    act(() => { result.current.validate('') })
    expect(result.current.isValidating).toBe(false)
  })
})
