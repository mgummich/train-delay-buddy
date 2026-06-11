/**
 * Golden path E2E — train → alternatives → companion
 * All API calls are mocked via page.route().
 */
import { test, expect, Page } from '@playwright/test'

// ── Shared mock data ─────────────────────────────────────────────────────────

const JOURNEY_ID = 'jrn_goldenpath01234567'

const MOCK_TRAIN = {
  trainNumber: 'ICE 123',
  date: '2026-06-11',
  origin:      { id: '8000261', name: 'München Hbf' },
  destination: { id: '8011160', name: 'Berlin Hbf' },
  stops: [
    { id: '8000261', name: 'München Hbf' },
    { id: '8000105', name: 'Frankfurt (Main) Hbf' },
    { id: '8011160', name: 'Berlin Hbf' },
  ],
  status: 'running',
}

const MOCK_STATIONS = {
  stations: [
    { id: '8000105', name: 'Frankfurt (Main) Hbf' },
    { id: '8000104', name: 'Frankfurt (Main) Süd' },
  ],
}

const MOCK_SUMMARY = {
  eta:                          '2026-06-11T17:24:00Z',
  status:                       'ok',
  timeGainVsOriginalMinutes:    18,
  timeGainVsCurrentRouteMinutes: null,
  minTransferBufferMinutes:     9,
  criticalTransfer:             false,
  alternativeAvailable:         false,
  dataConfidence:               'high',
  nextStep: {
    type:          'ride',
    stationName:   'Frankfurt (Main) Hbf',
    stationId:     '8000105',
    trainNumber:   'ICE 123',
    platform:      '7',
    departureTime: null,
    bufferMinutes: null,
  },
  dataFetchedAt:  '2026-06-11T15:23:45Z',
  lastUpdatedAt:  '2026-06-11T15:00:12Z',
}

const MOCK_ALTERNATIVE = {
  journeyId: 'jrn_alt001234567890ab',
  summary: { ...MOCK_SUMMARY, timeGainVsOriginalMinutes: 18 },
  legs: [],
}

const MOCK_JOURNEY_RESPONSE = {
  journeyId:    JOURNEY_ID,
  plausibility: { onTrainConfidence: 'high', reason: null },
  summary:      MOCK_SUMMARY,
  alternatives: [MOCK_ALTERNATIVE],
}

// ── Route mock setup ─────────────────────────────────────────────────────────

async function setupMocks(page: Page) {
  await page.route('**/v1/trains/**', route =>
    route.fulfill({ json: MOCK_TRAIN }),
  )
  await page.route('**/v1/stations**', route =>
    route.fulfill({ json: MOCK_STATIONS }),
  )
  await page.route('**/v1/journeys', route => {
    if (route.request().method() === 'POST') {
      route.fulfill({ status: 201, json: MOCK_JOURNEY_RESPONSE,
        headers: { Location: `/v1/journeys/${JOURNEY_ID}` } })
    } else {
      route.continue()
    }
  })
  await page.route(`**/v1/journeys/${JOURNEY_ID}`, route => {
    if (route.request().method() === 'DELETE') {
      route.fulfill({ status: 204 })
    } else {
      route.fulfill({ json: { journeyId: JOURNEY_ID, summary: MOCK_SUMMARY, legs: [], stops: [] } })
    }
  })
  await page.route(`**/v1/journeys/${JOURNEY_ID}/summary`, route =>
    route.fulfill({
      json: MOCK_SUMMARY,
      headers: { ETag: `"${JOURNEY_ID}:1749600000:1"` },
    }),
  )
  await page.route(`**/v1/journeys/${JOURNEY_ID}/legs`, route =>
    route.fulfill({ json: { legs: [], stops: [] } }),
  )
  await page.route(`**/v1/journeys/${JOURNEY_ID}/alternatives`, route =>
    route.fulfill({ json: { data: [MOCK_ALTERNATIVE], totalCount: 1 } }),
  )
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('golden path — train → alternatives → companion', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
  })

  test('navigates from start to companion in < 30s', async ({ page }) => {
    const start = Date.now()
    await page.goto('/')

    // StartScreen: fill train number
    await page.getByLabel(/Zugnummer/i).fill('ICE 123')
    await page.getByLabel(/Zugnummer/i).blur()
    // train validation response arrives
    await expect(page.getByLabel(/Zugnummer/i)).not.toHaveAttribute('aria-invalid', 'true')

    // fill destination autocomplete
    await page.getByLabel(/Zielbahnhof/i).fill('Frank')
    await expect(page.getByRole('option', { name: /Frankfurt.*Hbf/i })).toBeVisible()
    await page.getByRole('option', { name: /Frankfurt.*Hbf/i }).click()

    // submit
    await page.getByRole('button', { name: /Beste Verbindung/i }).click()

    // AlternativesScreen appears
    await expect(page).toHaveURL(/\/journey\/.*\/alternatives/)
    await expect(page.getByText(/früher am Ziel|früher ankommen/i)).toBeVisible({ timeout: 10_000 })

    // select alternative
    await page.getByTestId('alternative-card').first().click()
    await page.getByRole('button', { name: /Route wählen/i }).click()

    // CompanionScreen
    await expect(page).toHaveURL(/\/journey\/.*\/companion/)
    await expect(page.getByTestId('summary-header')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('timeline')).toBeVisible()

    expect(Date.now() - start).toBeLessThan(30_000)
  })

  test('URL contains journeyId after navigation', async ({ page }) => {
    await page.goto('/')
    await fillAndSubmitForm(page)
    await selectFirstAlternative(page)
    expect(page.url()).toMatch(/\/journey\/jrn_[0-9a-z]{12,26}\/companion/)
  })

  test('ETA displayed in Europe/Berlin time (19:24 for 17:24 UTC)', async ({ page }) => {
    await page.goto('/')
    await fillAndSubmitForm(page)
    await selectFirstAlternative(page)
    // 2026-06-11T17:24:00Z = 19:24 in CEST (UTC+2)
    await expect(page.getByTestId('eta')).toHaveText('19:24')
  })

  test('plausibility dialog shown when confidence is low', async ({ page }) => {
    await page.route('**/v1/journeys', route => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 201, json: {
          ...MOCK_JOURNEY_RESPONSE,
          plausibility: { onTrainConfidence: 'low', reason: 'Train has passed destination' },
        }, headers: { Location: `/v1/journeys/${JOURNEY_ID}` } })
      } else route.continue()
    })

    await page.goto('/')
    await fillAndSubmitForm(page)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText(/konnten nicht sicher feststellen/i)).toBeVisible()
    await page.getByRole('button', { name: /Ja, Route planen/i }).click()
    await expect(page).toHaveURL(/\/journey\/.*\/alternatives/)
  })

  test('"Reise abschließen" terminates and returns to start', async ({ page }) => {
    await page.goto('/')
    await fillAndSubmitForm(page)
    await selectFirstAlternative(page)

    await page.getByRole('button', { name: /Reise abschließen/i }).click()
    await expect(page).toHaveURL('/')
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fillAndSubmitForm(page: Page) {
  await page.getByLabel(/Zugnummer/i).fill('ICE 123')
  await page.getByLabel(/Zielbahnhof/i).fill('Frank')
  await expect(page.getByRole('option', { name: /Frankfurt.*Hbf/i })).toBeVisible()
  await page.getByRole('option', { name: /Frankfurt.*Hbf/i }).click()
  await page.getByRole('button', { name: /Beste Verbindung/i }).click()
  await expect(page).toHaveURL(/\/journey\/.*\/alternatives/)
}

async function selectFirstAlternative(page: Page) {
  await page.getByTestId('alternative-card').first().click()
  await page.getByRole('button', { name: /Route wählen/i }).click()
  await expect(page).toHaveURL(/\/journey\/.*\/companion/)
}
