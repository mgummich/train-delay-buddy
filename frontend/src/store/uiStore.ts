import { create } from 'zustand'

/** A transient notification shown to the user. Identified by a random UUID. */
export interface Toast {
  id: string
  message: string
  type: 'error' | 'info'
}

interface UIState {
  confirmDialogOpen: boolean
  toasts: Toast[]
  openConfirmDialog: () => void
  closeConfirmDialog: () => void
  addToast: (message: string, type?: Toast['type']) => void
  removeToast: (id: string) => void
}

/**
 * Zustand store for transient UI state — the confirm dialog and the toast queue.
 * Not persisted; reset on page reload.
 */
export const useUIStore = create<UIState>((set) => ({
  confirmDialogOpen: false,
  toasts: [],

  openConfirmDialog: () => set({ confirmDialogOpen: true }),
  closeConfirmDialog: () => set({ confirmDialogOpen: false }),
  addToast: (message, type = 'error') =>
    set((state) => ({
      toasts: [...state.toasts, { id: crypto.randomUUID(), message, type }],
    })),
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))
