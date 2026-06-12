import createClient from 'openapi-fetch'
import type { paths } from './types.gen'
import { getInstallId } from '@/lib/installId'

let installIdCache = ''

async function resolveInstallId(): Promise<string> {
  if (!installIdCache) {
    installIdCache = await getInstallId()
  }
  return installIdCache
}

/**
 * Typed openapi-fetch client for all backend calls.
 * Automatically injects `X-Install-Id` on every request via middleware.
 * `fetch` is wrapped to allow MSW interception in tests after module init.
 */
export const apiClient = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  // Use a wrapper so tests can patch globalThis.fetch after module init (e.g. MSW).
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
})

// Inject X-Install-Id on every request
apiClient.use({
  async onRequest({ request }) {
    request.headers.set('X-Install-Id', await resolveInstallId())
    return request
  },
})

/**
 * DELETE /v1/journeys/{id} returns 404 on second call by design (non-idempotent).
 * Callers should treat 404 on DELETE as a no-op, not an error.
 */
export function isDeleteNotFound(status: number, url: string): boolean {
  return status === 404 && /\/v1\/journeys\/[^/]+$/.test(url)
}
