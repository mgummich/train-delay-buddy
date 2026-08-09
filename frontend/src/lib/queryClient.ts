import { QueryClient } from '@tanstack/react-query'

/**
 * Reads a numeric field off a thrown query error. Hooks throw via `apiError`,
 * which stamps `status` and `retryAfter` onto the parsed RFC 7807 Problem body
 * (or onto a synthetic Error when the body wasn't parseable JSON).
 */
function errorNumber(error: unknown, key: 'status' | 'retryAfter'): number | undefined {
  if (typeof error === 'object' && error !== null && key in error) {
    const v = (error as Record<string, unknown>)[key]
    if (typeof v === 'number') return v
  }
  return undefined
}

/**
 * Singleton TanStack Query client shared across the app.
 * Retry policy: skip on 4xx (client error) except 429, exponential backoff
 * up to 3 attempts otherwise.
 * Honours `Retry-After` per openapi.yaml: min(Retry-After × 2^n, 300s).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60_000,
      retry: (failureCount, error: unknown) => {
        const status = errorNumber(error, 'status')
        if (status !== undefined && status < 500 && status !== 429) return false
        return failureCount < 3
      },
      retryDelay: (attemptIndex, error: unknown) => {
        const retryAfter = errorNumber(error, 'retryAfter')
        if (retryAfter) return Math.min(retryAfter * 1000 * 2 ** attemptIndex, 300_000)
        return Math.min(1000 * 2 ** attemptIndex, 30_000)
      },
    },
  },
})

/** Typed query key factories. Use these everywhere — never hardcode key arrays. */
export const queryKeys = {
  journeyFull: (id: string) => ['journey', 'full', id] as const,
  journeySummary: (id: string) => ['journey', 'summary', id] as const,
  journeyLegs: (id: string) => ['journey', 'legs', id] as const,
  journeyAlternatives: (id: string) => ['journey', 'alternatives', id] as const,
  stations: (q: string) => ['stations', q] as const,
  train: (number: string, date: string) => ['train', number, date] as const,
}
