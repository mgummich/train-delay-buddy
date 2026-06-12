import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { queryKeys } from '@/lib/queryClient'
import { saveJourney } from '@/lib/indexeddb'
import { useJourneyStore } from '@/store/journeyStore'
import type { JourneySummary } from '@/api/validation'

type NetworkInformation = { saveData?: boolean; effectiveType?: string }

/**
 * Computes the polling interval in milliseconds based on journey urgency and
 * network conditions.
 *
 * When `navigator.connection.saveData` is `true` the interval is throttled to
 * 90 s to respect the user's data-saver preference. Otherwise `status ===
 * 'critical'` or a `minBuffer` below 5 minutes triggers an aggressive 10 s
 * interval; all other cases use 30 s.
 *
 * @param status - Current journey status string (e.g. `'ok'`, `'critical'`).
 * @param minBuffer - Minimum transfer buffer in minutes from the latest summary,
 *   or `undefined` / `null` when not yet known.
 * @returns Milliseconds until the next refetch, or `false` to disable polling.
 */
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

/**
 * Fetches the journey summary from the API, using an ETag conditional request
 * to avoid redundant payload transfers.
 *
 * @param journeyId - The journey identifier used as the path parameter.
 * @param etag - ETag value from the previous response, sent as
 *   `If-None-Match`. Pass `null` to perform an unconditional request.
 * @returns `null` when the server responds with 304 Not Modified (no new data),
 *   or an object `{ data, newEtag }` on a 200 OK response where `newEtag` may
 *   be `null` if the server omitted the `ETag` header.
 * @throws The upstream error (or a synthetic `Error`) for any non-304
 *   failure response.
 */
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

/**
 * React Query hook that polls the journey summary endpoint with ETag-conditional
 * requests and an adaptive refetch interval.
 *
 * Behaviour overview:
 * - **ETag-conditional polling** — each poll sends the latest ETag as
 *   `If-None-Match`; a 304 response reuses the cached `JourneySummary`
 *   without touching state.
 * - **Adaptive refetch interval** — delegates to `getRefetchInterval` so the
 *   cadence tightens to 10 s during critical situations and relaxes to 90 s
 *   when `saveData` is active.
 * - **IndexedDB write-through** — every 200 response is persisted via
 *   `saveJourney` for offline access, fire-and-forget (errors are not
 *   propagated to the query).
 * - **Zustand side effects** — on a successful 200 the hook calls
 *   `setStatus` and `setEtag` on `useJourneyStore` so the rest of the app
 *   reacts to status changes without additional subscriptions.
 *
 * @param journeyId - Identifier of the journey to track.
 * @param currentEtag - Caller-supplied ETag to seed the first conditional
 *   request. Falls back to the value held in `useJourneyStore` when omitted
 *   or `null`.
 * @returns A `UseQueryResult<JourneySummary>` from TanStack Query.
 */
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
