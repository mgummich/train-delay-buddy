import { use, type ReactNode } from 'react'
import { createOfflineStatePromise } from '@/hooks/useOfflineState'

// Singleton promise — created once, shared across renders.
// React's `use()` will suspend until it resolves.
let hydrationPromise: Promise<void> | null = null

function getHydrationPromise(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = createOfflineStatePromise()
  }
  return hydrationPromise
}

/** Reset the singleton for testing — do not call in production code. */
export function _resetHydrationPromiseForTests(): void {
  hydrationPromise = null
}

/** Inject an already-resolved promise for testing — do not call in production code. */
export function _setHydrationPromiseForTests(p: Promise<void>): void {
  hydrationPromise = p
}

/**
 * Wraps RouterProvider. Suspends (via React 19 `use()`) until IndexedDB
 * has been read and journeyStore hydrated. This guarantees the router
 * loaders see the correct journeyId on cold start / refresh.
 *
 * Must be wrapped in <Suspense> in main.tsx.
 */
export function OfflineStateLoader({ children }: { children: ReactNode }) {
  use(getHydrationPromise())
  return <>{children}</>
}
