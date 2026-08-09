import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { apiClient, apiError } from '@/api/client'
import { queryKeys } from '@/lib/queryClient'

type JourneyFullData = Awaited<ReturnType<typeof fetchJourneyFull>>

async function fetchJourneyFull(journeyId: string) {
  const { data, error, response } = await apiClient.GET('/journeys/{id}', {
    params: { path: { id: journeyId } },
  })
  // Gate on response.ok, not on `error` — a non-JSON upstream failure leaves
  // `error` undefined and would otherwise resolve the query with undefined data.
  if (!response.ok) throw apiError(response, error)
  return data!
}

/** Query options for GET /journeys/{id}. Exported for use in router loaders. */
export function journeyFullQuery(journeyId: string): UseQueryOptions<JourneyFullData> {
  return {
    queryKey: queryKeys.journeyFull(journeyId),
    queryFn: () => fetchJourneyFull(journeyId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
    retryDelay: 0,
  }
}

/** Fetches the full journey (summary + legs) for the given journey ID. */
export function useJourneyFull(journeyId: string) {
  return useQuery(journeyFullQuery(journeyId))
}
