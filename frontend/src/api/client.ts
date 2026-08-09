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
  // Default to /v1 (matches the OpenAPI servers[0].url and the nginx/Vite proxy prefix).
  // Override via VITE_API_BASE_URL for cross-domain deployments (e.g. https://api.example.com/v1).
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/v1',
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
 * Normalises an openapi-fetch failure into a throwable carrying `status` and
 * `retryAfter` — the two fields the queryClient retry policy reads.
 *
 * The parsed Problem body alone is not enough on either axis: a non-JSON
 * upstream error (nginx 502/504 HTML) leaves `error` undefined, and the
 * `Retry-After` header is lost once the body has been parsed off the Response.
 */
export function apiError(response: Response, error?: unknown): unknown {
  // Two named fields assigned explicitly, not Object.assign with a spread of the
  // response — semgrep flags the latter as mass assignment, and the narrow form
  // is what we want anyway: nothing attacker-controlled reaches the throwable.
  const thrown = (error ?? new Error(`HTTP ${response.status}`)) as Record<string, unknown>
  thrown.status = response.status
  thrown.retryAfter = Number(response.headers.get('Retry-After')) || undefined
  return thrown
}

/**
 * DELETE /v1/journeys/{id} returns 404 on second call by design (non-idempotent).
 * Callers should treat 404 on DELETE as a no-op, not an error.
 */
export function isDeleteNotFound(status: number, url: string): boolean {
  return status === 404 && /\/v1\/journeys\/[^/]+$/.test(url)
}
