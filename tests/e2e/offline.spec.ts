/**
 * Offline degradation E2E
 * Verifies stale data is shown when network drops — no blank screen.
 */
import { test, expect, Page } from '@playwright/test'

const JOURNEY_ID = 'jrn_offline0123456789'

const MOCK_SUMMARY = {
  eta:                       '2026-06-11T17:00:00Z',
  status:                    'ok',
  timeGainVsOriginalMinutes: 15,
  timeGainVsCurrentRouteMinutes: null,
  minTransferBufferMinutes:  12,
  criticalTransfer:          false,
  alternativeAvailable:      false,
  dataConfidence:            'high',
  nextStep: {
    type: 'ride', stationName: 'Kassel Hbf', stationId: '8000294',
    trainNumber: 'RE 4321', platform: '5', departureTime: null, bufferMinutes: null,
  },
  dataFetchedAt: '2026-06-11T15:00:00Z',
  lastUpdatedAt: '2026-06-11T15:00:00Z',
}

test.describe('offline degradation', () => {
  test('companion shows stale data when network drops', async ({ page, context }) => {
    // Setup: navigate to companion with mocked API
    await page.route(`**/v1/journeys/${JOURNEY_ID}/summary`, route =>
      route.fulfill({ json: MOCK_SUMMARY, headers: { ETag: '"jrn:epoch:1"' } }),
    )
    await page.route(`**/v1/journeys/${JOURNEY_ID}/legs`, route =>
      route.fulfill({ json: { legs: [], stops: [] } }),
    )

    await page.goto(`/journey/${JOURNEY_ID}/companion`)
    const etaBefore = await page.getByTestId('eta').textContent()
    expect(etaBefore).toBeTruthy()

    // Go offline
    await context.setOffline(true)

    // Wait longer than polling interval (30s) — use fake timers if available,
    // otherwise wait for the error state to appear
    await expect(page.getByTestId('stale-indicator')).toBeVisible({ timeout: 35_000 })

    // ETA still shown — NOT a blank screen
    await expect(page.getByTestId('eta')).toBeVisible()
    await expect(page.getByTestId('eta')).toHaveText(etaBefore!)

    // "Offline" or "veraltet" indicator visible
    await expect(
      page.getByText(/Offline|veraltet|Zuletzt aktualisiert/i)
    ).toBeVisible()

    // Journey visible — no error boundary shown
    await expect(page.getByTestId('summary-header')).toBeVisible()
    await expect(page.getByTestId('timeline')).toBeVisible()
  })

  test('auto-recovers when network restores', async ({ page, context }) => {
    let pollCount = 0
    const UPDATED_ETA = '2026-06-11T17:15:00Z'

    await page.route(`**/v1/journeys/${JOURNEY_ID}/summary`, route => {
      pollCount++
      route.fulfill({
        json: { ...MOCK_SUMMARY, eta: UPDATED_ETA },
        headers: { ETag: `"jrn:epoch:${pollCount}"` },
      })
    })
    await page.route(`**/v1/journeys/${JOURNEY_ID}/legs`, route =>
      route.fulfill({ json: { legs: [], stops: [] } }),
    )

    await page.goto(`/journey/${JOURNEY_ID}/companion`)
    await expect(page.getByTestId('eta')).toBeVisible()

    // Go offline briefly
    await context.setOffline(true)
    await expect(page.getByTestId('stale-indicator')).toBeVisible({ timeout: 35_000 })

    // Restore
    await context.setOffline(false)

    // Stale indicator disappears after successful poll
    await expect(page.getByTestId('stale-indicator')).not.toBeVisible({ timeout: 35_000 })
  })

  test('no blank screen on direct URL navigation when offline', async ({ page, context }) => {
    // Simulate: user bookmarked URL, opens offline
    await context.setOffline(true)

    // Route will fail (network error)
    await page.route(`**/v1/journeys/**`, route => route.abort('failed'))

    await page.goto(`/journey/${JOURNEY_ID}/companion`)

    // Should show error state, NOT a crash or blank screen
    // Either companion error UI or redirect to start — both acceptable
    const hasErrorUI = await page.getByTestId('companion-error').isVisible().catch(() => false)
    const hasStartScreen = page.url().endsWith('/')

    expect(hasErrorUI || hasStartScreen).toBe(true)
  })
})
