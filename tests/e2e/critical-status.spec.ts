/**
 * Critical status E2E
 * Verifies warning UI, accelerated polling hint, and CTA visibility.
 */
import { test, expect, Page } from '@playwright/test'

const JOURNEY_ID = 'jrn_critical01234567'

test.describe('critical status', () => {
  test('shows warning banner and alternative CTA when status is critical', async ({ page }) => {
    await setupCriticalMocks(page, {
      status:                  'critical',
      minTransferBufferMinutes: 3,
      criticalTransfer:         true,
      alternativeAvailable:     true,
    })

    await page.goto(`/journey/${JOURNEY_ID}/companion`)

    // Warning visible
    await expect(page.getByTestId('critical-warning')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/Umstieg kritisch|kritisch/i)).toBeVisible()

    // CTA for alternatives
    await expect(page.getByRole('button', { name: /Alternative ansehen|Alternativen/i })).toBeVisible()
  })

  test('critical warning NOT shown when status is ok', async ({ page }) => {
    await setupCriticalMocks(page, { status: 'ok', minTransferBufferMinutes: 12 })
    await page.goto(`/journey/${JOURNEY_ID}/companion`)
    await expect(page.getByTestId('summary-header')).toBeVisible()
    await expect(page.getByTestId('critical-warning')).not.toBeVisible()
  })

  test('failed status shows route-not-usable UI and restart CTA', async ({ page }) => {
    await setupCriticalMocks(page, { status: 'failed' })
    await page.goto(`/journey/${JOURNEY_ID}/companion`)

    await expect(page.getByText(/Route nicht mehr nutzbar|nicht mehr nutzbar/i)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /Neue Verbindung suchen/i })).toBeVisible()
  })

  test('aria-live region announces critical transition to screen readers', async ({ page }) => {
    await setupCriticalMocks(page, { status: 'critical', criticalTransfer: true })
    await page.goto(`/journey/${JOURNEY_ID}/companion`)

    // The assertive live region must be in the DOM
    const liveRegion = page.locator('[role="alert"], [aria-live="assertive"]').first()
    await expect(liveRegion).toBeAttached()
  })
})

async function setupCriticalMocks(page: Page, summaryOverrides: Record<string, unknown>) {
  const summary = {
    eta:                       '2026-06-11T18:00:00Z',
    status:                    'ok',
    timeGainVsOriginalMinutes: 10,
    timeGainVsCurrentRouteMinutes: null,
    minTransferBufferMinutes:  10,
    criticalTransfer:          false,
    alternativeAvailable:      false,
    dataConfidence:            'high',
    nextStep: null,
    dataFetchedAt:  '2026-06-11T16:00:00Z',
    lastUpdatedAt:  '2026-06-11T16:00:00Z',
    ...summaryOverrides,
  }
  await page.route(`**/v1/journeys/${JOURNEY_ID}/summary`, route =>
    route.fulfill({ json: summary, headers: { ETag: '"jrn:epoch:99"' } }),
  )
  await page.route(`**/v1/journeys/${JOURNEY_ID}/legs`, route =>
    route.fulfill({ json: { legs: [], stops: [] } }),
  )
  await page.route(`**/v1/journeys/${JOURNEY_ID}/alternatives`, route =>
    route.fulfill({ json: { data: [], totalCount: 0 } }),
  )
}
