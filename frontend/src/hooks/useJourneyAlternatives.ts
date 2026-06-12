import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { queryKeys } from '@/lib/queryClient'

type AlternativesData = Awaited<ReturnType<typeof fetchAlternatives>>

async function fetchAlternatives(journeyId: string) {
  const { data, error } = await apiClient.GET('/journeys/{id}/alternatives', {
    params: { path: { id: journeyId } },
  })
  if (error) throw error
  return data!
}

/**
 * Returns TanStack Query options for `GET /journeys/{id}/alternatives`.
 * Export for use in React Router loaders (`qc.ensureQueryData`).
 * staleTime 0 — alternatives must always refetch (realtime recompute results).
 */
export function journeyAlternativesQuery(journeyId: string): UseQueryOptions<AlternativesData> {
  return {
    queryKey: queryKeys.journeyAlternatives(journeyId),
    queryFn:  () => fetchAlternatives(journeyId),
    staleTime: 0,
    gcTime:    2 * 60_000,
  }
}

/** Fetches the ranked alternatives list for the given journey ID. Always refetches on mount. */
export function useJourneyAlternatives(journeyId: string) {
  return useQuery(journeyAlternativesQuery(journeyId))
}
