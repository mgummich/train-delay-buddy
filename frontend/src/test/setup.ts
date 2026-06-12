/**
 * Vitest global test setup
 * Runs before every test file.
 */
import '@testing-library/jest-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Minimal i18next init so useTranslation() works without a provider in tests.
if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: 'de',
    fallbackLng: 'de',
    resources: {},
    interpolation: { escapeValue: false },
  })
}
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, afterAll, vi } from 'vitest'
import { server } from './msw-handlers'

// Start MSW service worker before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))

// Reset handlers + cleanup DOM after each test
afterEach(() => {
  server.resetHandlers()
  cleanup()
})

// Stop MSW after all tests
afterAll(() => server.close())

// ── IndexedDB mock ───────────────────────────────────────────────────────────
// jsdom doesn't ship IndexedDB — use fake-indexeddb
import 'fake-indexeddb/auto'

// ── localStorage helpers (available in tests) ────────────────────────────────
beforeEach(() => {
  localStorage.clear()
})

// ── matchMedia mock (not in jsdom) ──────────────────────────────────────────
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// ── navigator.connection mock ────────────────────────────────────────────────
Object.defineProperty(navigator, 'connection', {
  writable: true,
  value: { saveData: false, effectiveType: '4g' },
})

// ── Page Visibility API mock ─────────────────────────────────────────────────
Object.defineProperty(document, 'visibilityState', {
  writable: true,
  value: 'visible',
})

// ── ResizeObserver stub (jsdom doesn't implement it) ─────────────────────────
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
