import { create } from 'zustand'

interface JourneyState {
  /** The active journey ID, or null when no journey is being monitored. */
  journeyId: string | null
  /** Last ETag received from GET /journeys/{id}/summary; null before first successful fetch. */
  etag: string | null
  /** Current monitoring status from the latest summary poll; null before first fetch. */
  status: 'ok' | 'critical' | 'failed' | null
  /** True when the backend has computed at least one faster alternative route. */
  alternativeAvailable: boolean
  /** Initialises the store with a journey ID and its initial ETag (may be null). */
  setJourney: (id: string, etag: string | null) => void
  /** Updates status and alternativeAvailable from a fresh summary response. */
  setStatus: (status: 'ok' | 'critical' | 'failed', alternativeAvailable: boolean) => void
  /** Stores the ETag from the latest 200 response for the next conditional poll. */
  setEtag: (etag: string) => void
  /** Resets all fields to their initial values; called on journey termination. */
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
