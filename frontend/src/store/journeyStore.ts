import { create } from 'zustand'

interface JourneyState {
  journeyId: string | null
  etag: string | null
  status: 'ok' | 'critical' | 'failed' | null
  alternativeAvailable: boolean
  setJourney: (id: string, etag: string | null) => void
  setStatus: (status: 'ok' | 'critical' | 'failed', alternativeAvailable: boolean) => void
  setEtag: (etag: string) => void
  clearJourney: () => void
}

/**
 * Zustand store for the currently active journey.
 * Holds the journey ID, last-known ETag (for conditional polling), status, and
 * whether an alternative is available. Not persisted — restored from IndexedDB on boot.
 */
export const useJourneyStore = create<JourneyState>((set) => ({
  journeyId: null,
  etag: null,
  status: null,
  alternativeAvailable: false,

  setJourney: (journeyId, etag) => set({ journeyId, etag }),
  setStatus: (status, alternativeAvailable) => set({ status, alternativeAvailable }),
  setEtag: (etag) => set({ etag }),
  clearJourney: () =>
    set({ journeyId: null, etag: null, status: null, alternativeAvailable: false }),
}))
