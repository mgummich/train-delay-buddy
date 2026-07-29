import { QueryClient } from '@tanstack/react-query'

/**
 * Extracts the HTTP status from a thrown query error. Hooks throw the parsed
 * RFC 7807 Problem body from openapi-fetch (which carries a numeric `status`),
 * or an Error with a `status` property attached at the throw site.
 */
function errorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const s = (error as { status: unknown }).status
    if (typeof s === 'number') return s
  }
  return undefined
}

/**
 * Singleton TanStack Query client shared across the app.
 * Retry policy: skip on 4xx (client error) except 429, exponential backoff
 * up to 3 attempts otherwise.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60_000,
      retry: (failureCount, error: unknown) => {
        const status = errorStatus(error)
        if (status !== undefined && status < 500 && status !== 429) return false
        return failureCount < 3
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000),
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
