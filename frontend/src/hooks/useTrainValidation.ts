import { useState, useCallback } from 'react'
import { apiClient } from '@/api/client'

interface TrainData {
  trainNumber: string
  stops: Array<{ id: string; name: string }>
}

interface UseTrainValidationResult {
  validate:     (trainNumber: string) => void
  error:        string | null
  trainData:    TrainData | null
  isValidating: boolean
  clearError:   () => void
}

export function useTrainValidation(): UseTrainValidationResult {
  const [error, setError]               = useState<string | null>(null)
  const [trainData, setTrainData]       = useState<TrainData | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  const validate = useCallback((trainNumber: string) => {
    if (!trainNumber.trim()) return

    setIsValidating(true)
    setError(null)

    const normalized = trainNumber.trim().toUpperCase().replace(/([A-Z]+)(\d)/, '$1 $2')

    void apiClient
      .GET('/trains/{number}', {
        params: {
          path:  { number: normalized.replace(/\s/g, '') },
          query: { date: new Date().toISOString().split('T')[0]! },
        },
      })
      .then(({ data, error: apiError }) => {
        if (apiError) {
          setError('Zug nicht gefunden für heute')
          setTrainData(null)
        } else if (data) {
          setTrainData({
            trainNumber: data.trainNumber,
            stops: (data.stops ?? []).map(s => ({ id: s.id, name: s.name })),
          })
          setError(null)
        }
      })
      .catch(() => {
        setError('Zug nicht gefunden für heute')
        setTrainData(null)
      })
      .finally(() => setIsValidating(false))
  }, [])

  return {
    validate,
    error,
    trainData,
    isValidating,
    clearError: () => setError(null),
  }
}
