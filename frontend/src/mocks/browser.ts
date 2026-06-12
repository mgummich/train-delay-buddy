import { setupWorker } from 'msw/browser'
import { defaultHandlers } from '@/test/msw-handlers'

// Service worker for browser-based MSW (dev only)
export const worker = setupWorker(...defaultHandlers)
