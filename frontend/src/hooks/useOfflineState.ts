import { loadJourney } from '@/lib/indexeddb'
import { useJourneyStore } from '@/store/journeyStore'

/** Promise that resolves once IndexedDB has been read and Zustand hydrated. */
export function createOfflineStatePromise(): Promise<void> {
  return loadJourney().then((cached) => {
    if (cached) {
      useJourneyStore.getState().setJourney(cached.journeyId, cached.etag)
    }
  })
}
