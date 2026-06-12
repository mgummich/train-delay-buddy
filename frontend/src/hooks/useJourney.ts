import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { queryKeys } from '@/lib/queryClient'
import { saveJourney } from '@/lib/indexeddb'
import { useJourneyStore } from '@/store/journeyStore'
import type { JourneySummary } from '@/api/validation'

type NetworkInformation = { saveData?: boolean; effectiveType?: string }

function getRefetchInterval(
  status: string | undefined,
  minBuffer: number | undefined | null
): number | false {
  const nav = navigator as Navigator & { connection?: NetworkInformation }
  if (nav.connection?.saveData) return 90_000
  if (status === 'critical' || (minBuffer !== undefined && minBuffer !== null && minBuffer < 5))
    return 10_000
  return 30_000
}

async function fetchSummary(journeyId: string, etag: string | null) {
  const headers: Record<string, string> = {}
  if (etag) headers['If-None-Match'] = etag

  const { data, response, error } = await apiClient.GET('/journeys/{id}/summary', {
    params: { path: { id: journeyId } },
    headers,
  })

  if (!response.ok && response.status !== 304) throw error ?? new Error(`HTTP ${response.status}`)

  if (response.status === 304) return null

  return { data: data!, newEtag: response.headers.get('ETag') }
}

export function useJourney(journeyId: string, currentEtag?: string | null) {
  const { setStatus, setEtag } = useJourneyStore()
  const qc = useQueryClient()

  return useQuery({
    queryKey: queryKeys.journeySummary(journeyId),
    queryFn: async (): Promise<JourneySummary> => {
      const etag = currentEtag ?? useJourneyStore.getState().etag
      const result = await fetchSummary(journeyId, etag)

      if (!result) {
        const cached = qc.getQueryData<JourneySummary>(queryKeys.journeySummary(journeyId))
        if (cached) return cached
        // Stale ETag caused a 304 against an empty cache — clear it so the
        // next poll sends no conditional header and gets a fresh 200.
        useJourneyStore.setState({ etag: null })
        throw new Error('304 with no prior cache — will retry')
      }

      const { data, newEtag } = result

      setStatus(data.status as 'ok' | 'critical' | 'failed', data.alternativeAvailable)
      if (newEtag) setEtag(newEtag)

      void saveJourney({
        journeyId,
        etag: newEtag,
        summary: data,
        savedAt: new Date().toISOString(),
      })

      return data as JourneySummary
    },
    refetchInterval: (query) => {
      const d = query.state.data
      return getRefetchInterval(d?.status, d?.minTransferBufferMinutes)
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 5 * 60_000,
  })
}
