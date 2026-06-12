import { QueryClient } from '@tanstack/react-query'

/**
 * Singleton TanStack Query client shared across the app.
 * Retry policy: skip on 4xx (client error), exponential backoff on 5xx up to 3 attempts.
 * Respects `Retry-After` header on 429 responses.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60_000,
      retry: (failureCount, error: unknown) => {
        if (error instanceof Response && error.status < 500) return false
        return failureCount < 3
      },
      retryDelay: (attemptIndex, error: unknown) => {
        // Honour Retry-After on 429 responses
        if (error instanceof Response && error.status === 429) {
          const retryAfter = error.headers.get('Retry-After')
          if (retryAfter) {
            return parseInt(retryAfter, 10) * 1000 * 2 ** attemptIndex
          }
        }
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
