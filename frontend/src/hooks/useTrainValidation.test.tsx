import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { server, MSW_ERRORS } from '@/test/msw-handlers'
import { useTrainValidation } from './useTrainValidation'

const TRAINS_URL = 'http://localhost/v1/trains/:number'

describe('useTrainValidation', () => {
  it('starts with no error', () => {
    const { result } = renderHook(() => useTrainValidation())
    expect(result.current.error).toBeNull()
    expect(result.current.isValidating).toBe(false)
  })

  it('sets error when train not found', async () => {
    server.use(http.get(TRAINS_URL, () => MSW_ERRORS.trainNotFound()))
    const { result } = renderHook(() => useTrainValidation())

    act(() => { result.current.validate('ICE999') })

    await waitFor(() => expect(result.current.isValidating).toBe(false))
    expect(result.current.error).toBe('Zug nicht gefunden für heute')
  })

  it('clears error on valid train', async () => {
    const { result } = renderHook(() => useTrainValidation())

    act(() => { result.current.validate('ICE 123') })

    await waitFor(() => expect(result.current.isValidating).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.trainData?.trainNumber).toBe('ICE 123')
  })

  it('does nothing on empty input', () => {
    const { result } = renderHook(() => useTrainValidation())
    act(() => { result.current.validate('') })
    expect(result.current.isValidating).toBe(false)
  })

  it('reset() clears error and trainData', async () => {
    const { result } = renderHook(() => useTrainValidation())

    act(() => { result.current.validate('ICE 123') })
    await waitFor(() => expect(result.current.trainData).not.toBeNull())

    act(() => { result.current.reset() })
    expect(result.current.trainData).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.isValidating).toBe(false)
  })
})
