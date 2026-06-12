import { useState, useCallback, useRef, useEffect } from 'react'
import { apiClient } from '@/api/client'

interface Station {
  id: string
  name: string
}

interface UseStationSearchResult {
  search: (query: string) => void
  stations: Station[]
  isLoading: boolean
  clear: () => void
}

/**
 * Searches stations via `GET /stations` with 200 ms debounce and stale-response guard.
 * Queries shorter than 2 characters clear the results immediately without a network call.
 */
export function useStationSearch(): UseStationSearchResult {
  const [stations, setStations] = useState<Station[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // seq prevents stale responses from overwriting fresher results
  const seqRef = useRef(0)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const search = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query.trim() || query.trim().length < 2) {
      setStations([])
      setIsLoading(false)
      return
    }

    const seq = ++seqRef.current

    debounceRef.current = setTimeout(() => {
      setIsLoading(true)

      void apiClient
        .GET('/stations', { params: { query: { q: query } } })
        .then(({ data }) => {
          if (seq === seqRef.current && data) setStations(data.stations ?? [])
        })
        .finally(() => {
          if (seq === seqRef.current) setIsLoading(false)
        })
    }, 200)
  }, [])

  const clear = useCallback(() => {
    seqRef.current++
    setStations([])
    setIsLoading(false)
  }, [])

  return { search, stations, isLoading, clear }
}
