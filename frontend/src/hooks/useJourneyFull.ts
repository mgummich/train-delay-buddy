import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { queryKeys } from '@/lib/queryClient'

type JourneyFullData = Awaited<ReturnType<typeof fetchJourneyFull>>

async function fetchJourneyFull(journeyId: string) {
  const { data, error } = await apiClient.GET('/journeys/{id}', {
    params: { path: { id: journeyId } },
  })
  if (error) throw error
  return data!
}

export function journeyFullQuery(journeyId: string): UseQueryOptions<JourneyFullData> {
  return {
    queryKey: queryKeys.journeyFull(journeyId),
    queryFn:  () => fetchJourneyFull(journeyId),
    staleTime: 30_000,
    gcTime:    5 * 60_000,
  }
}

export function useJourneyFull(journeyId: string) {
  return useQuery(journeyFullQuery(journeyId))
}
