/**
 * URL routing + deep-link E2E
 * Verifies journeyId in URL, browser refresh, back-navigation.
 */
import { test, expect } from '@playwright/test'

const JOURNEY_ID = 'jrn_deeplink0123456789'

const MOCK_JOURNEY = {
  journeyId: JOURNEY_ID,
  summary: {
    eta:                       '2026-06-11T17:30:00Z',
    status:                    'ok',
    timeGainVsOriginalMinutes: 8,
    timeGainVsCurrentRouteMinutes: null,
    minTransferBufferMinutes:  7,
    criticalTransfer:          false,
    alternativeAvailable:      false,
    dataConfidence:            'high',
    nextStep:       null,
    dataFetchedAt:  '2026-06-11T15:30:00Z',
    lastUpdatedAt:  '2026-06-11T15:30:00Z',
  },
  legs:  [],
  stops: [],
}

test.describe('URL routing and deep-links', () => {
  test('direct URL to companion loads journey', async ({ page }) => {
    await page.route(`**/v1/journeys/${JOURNEY_ID}`, route =>
      route.fulfill({ json: MOCK_JOURNEY }),
    )
    await page.route(`**/v1/journeys/${JOURNEY_ID}/summary`, route =>
      route.fulfill({ json: MOCK_JOURNEY.summary, headers: { ETag: '"jrn:epoch:1"' } }),
    )
    await page.route(`**/v1/journeys/${JOURNEY_ID}/legs`, route =>
      route.fulfill({ json: { legs: [], stops: [] } }),
    )

    await page.goto(`/journey/${JOURNEY_ID}/companion`)
    await expect(page.getByTestId('companion-screen')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('eta')).toBeVisible()
  })

  test('direct URL to unknown journeyId redirects to /', async ({ page }) => {
    await page.route('**/v1/journeys/**', route =>
      route.fulfill({
        status: 404,
        json: { type: 'urn:vbb:error:journey-not-found', title: 'Not Found', status: 404 },
      }),
    )

    await page.goto('/journey/jrn_doesnotexist/companion')
    await expect(page).toHaveURL('/')
  })

  test('browser refresh on companion retains journey state', async ({ page }) => {
    let callCount = 0
    await page.route(`**/v1/journeys/${JOURNEY_ID}`, route => {
      callCount++
      route.fulfill({ json: MOCK_JOURNEY })
    })
    await page.route(`**/v1/journeys/${JOURNEY_ID}/summary`, route =>
      route.fulfill({ json: MOCK_JOURNEY.summary, headers: { ETag: '"jrn:epoch:1"' } }),
    )
    await page.route(`**/v1/journeys/${JOURNEY_ID}/legs`, route =>
      route.fulfill({ json: { legs: [], stops: [] } }),
    )

    await page.goto(`/journey/${JOURNEY_ID}/companion`)
    await expect(page.getByTestId('companion-screen')).toBeVisible()

    await page.reload()
    // Journey should be visible after reload — from IndexedDB or re-fetch
    await expect(page.getByTestId('companion-screen')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('eta')).toBeVisible()
  })

  test('browser back from companion to alternatives works', async ({ page }) => {
    await page.route(`**/v1/journeys/${JOURNEY_ID}`, route =>
      route.fulfill({ json: { ...MOCK_JOURNEY, alternatives: [] } }),
    )
    await page.route(`**/v1/journeys/${JOURNEY_ID}/summary`, route =>
      route.fulfill({ json: MOCK_JOURNEY.summary, headers: { ETag: '"jrn:epoch:1"' } }),
    )
    await page.route(`**/v1/journeys/${JOURNEY_ID}/legs`, route =>
      route.fulfill({ json: { legs: [], stops: [] } }),
    )
    await page.route(`**/v1/journeys/${JOURNEY_ID}/alternatives`, route =>
      route.fulfill({ json: { data: [], totalCount: 0 } }),
    )

    await page.goto(`/journey/${JOURNEY_ID}/alternatives`)
    await page.goto(`/journey/${JOURNEY_ID}/companion`)
    await expect(page).toHaveURL(/companion/)

    await page.goBack()
    await expect(page).toHaveURL(/alternatives/)
  })
})
