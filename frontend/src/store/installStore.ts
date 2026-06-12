import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** User-controlled routing constraints, mirrored to the backend on journey creation. */
export interface JourneyFilters {
  dbOnly: boolean
  maxTransfers: number | null
  safetyLevel: 'aggressive' | 'normal' | 'cautious'
}

const defaultFilters: JourneyFilters = {
  dbOnly: true,
  maxTransfers: null,
  safetyLevel: 'normal',
}

interface InstallState {
  installId: string
  filters: JourneyFilters
  setInstallId: (id: string) => void
  setFilters: (filters: Partial<JourneyFilters>) => void
}

/**
 * Zustand store for device identity and user preferences.
 * Persisted to localStorage under key `"vb-install"`.
 * `installId` is synced from IndexedDB on first load via `getInstallId()`.
 */
export const useInstallStore = create<InstallState>()(
  persist(
    (set) => ({
      installId: '',
      filters: defaultFilters,
      setInstallId: (installId) => set({ installId }),
      setFilters: (partial) => set((state) => ({ filters: { ...state.filters, ...partial } })),
    }),
    {
      name: 'vb-install',
      partialize: (state) => ({ installId: state.installId, filters: state.filters }),
    }
  )
)
