import { useState, useCallback, useRef } from 'react'
import { apiClient } from '@/api/client'

interface TrainData {
  trainNumber: string
  stops: Array<{ id: string; name: string }>
}

interface UseTrainValidationResult {
  validate: (trainNumber: string) => void
  reset: () => void
  error: string | null
  trainData: TrainData | null
  isValidating: boolean
}

/**
 * Validates a train number against `GET /trains/{number}` for today's date.
 *
 * Uses a monotonic sequence counter to discard stale responses — safe to call
 * on every keystroke. Call `reset()` when the input is cleared.
 */
export function useTrainValidation(): UseTrainValidationResult {
  const [error, setError] = useState<string | null>(null)
  const [trainData, setTrainData] = useState<TrainData | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const seqRef = useRef(0)

  const validate = useCallback((trainNumber: string) => {
    if (!trainNumber.trim()) return

    const seq = ++seqRef.current
    setIsValidating(true)
    setError(null)

    const normalized = trainNumber
      .trim()
      .toUpperCase()
      .replace(/([A-Z]+)(\d)/, '$1 $2')

    void apiClient
      .GET('/trains/{number}', {
        params: {
          path: { number: normalized.replace(/\s/g, '') },
          query: { date: new Date().toISOString().split('T')[0]! },
        },
      })
      .then(({ data, error: apiError }) => {
        if (seq !== seqRef.current) return
        if (apiError) {
          setError('Zug nicht gefunden für heute')
          setTrainData(null)
        } else if (data) {
          setTrainData({
            trainNumber: data.trainNumber,
            stops: (data.stops ?? []).map((s) => ({ id: s.id, name: s.name })),
          })
          setError(null)
        }
      })
      .catch(() => {
        if (seq !== seqRef.current) return
        setError('Zug nicht gefunden für heute')
        setTrainData(null)
      })
      .finally(() => {
        if (seq === seqRef.current) setIsValidating(false)
      })
  }, [])

  const reset = useCallback(() => {
    seqRef.current++
    setError(null)
    setTrainData(null)
    setIsValidating(false)
  }, [])

  return {
    validate,
    reset,
    error,
    trainData,
    isValidating,
  }
}
