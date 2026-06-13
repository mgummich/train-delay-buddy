import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY } from '@/test/msw-handlers'
import { buildSummary, buildLeg, buildStop } from '@/test/factories'
import { CompanionScreen } from './CompanionScreen'
import '../i18n/index'

const FULL_JOURNEY = {
  journeyId: DEFAULT_JOURNEY_ID,
  summary: DEFAULT_SUMMARY,
  legs: [buildLeg()],
  stops: [
    buildStop({ stationName: 'Frankfurt (Main) Hbf' }),
    buildStop({ stationName: 'Göttingen' }),
  ],
  alternatives: [],
}

function renderCompanion(journeyId = DEFAULT_JOURNEY_ID) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['journey', 'full', journeyId], FULL_JOURNEY)
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={[`/journey/${journeyId}/companion`]}
      >
        <Routes>
          <Route path="/journey/:journeyId/companion" element={<CompanionScreen />} />
          <Route
            path="/journey/:journeyId/alternatives"
            element={<div data-testid="alternatives" />}
          />
          <Route path="/" element={<div data-testid="start" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('CompanionScreen', () => {
  it('renders time gain from summary', async () => {
    renderCompanion()
    await waitFor(() => expect(screen.getByText(/18 Min/)).toBeTruthy())
  })

  it('renders Timeline and Karte tabs', async () => {
    renderCompanion()
    await waitFor(() => expect(screen.getByText('Timeline')).toBeTruthy())
    expect(screen.getByText('Karte')).toBeTruthy()
  })

  it('switches to Karte tab on click', async () => {
    renderCompanion()
    await waitFor(() => screen.getByText('Karte'))
    fireEvent.click(screen.getByText('Karte'))
    await waitFor(() => expect(screen.getByText(/Schematische Übersicht/)).toBeTruthy())
  })

  it('shows "Reise abschließen" button', async () => {
    renderCompanion()
    await waitFor(() => screen.getByText(/Reise abschließen/))
  })

  it('DELETE called and navigate to / on "Reise abschließen"', async () => {
    let deleteCalled = false
    server.use(
      http.delete('/v1/journeys/:id', () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      })
    )
    renderCompanion()
    await waitFor(() => screen.getByText(/Reise abschließen/))
    fireEvent.click(screen.getByText(/Reise abschließen/))
    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(screen.getByTestId('start')).toBeTruthy())
  })

  it('shows staleness banner when dataFetchedAt is stale', async () => {
    // 61s > 30s (0.5 min) threshold → "Möglicherweise veraltet"
    const staleTime = new Date(Date.now() - 61 * 1000).toISOString()
    // Override the live-summary poll so useJourney also returns stale dataFetchedAt.
    // Without this, the default MSW handler returns a fresh timestamp that overrides the seed.
    server.use(
      http.get('/v1/journeys/:id/summary', () =>
        HttpResponse.json({
          ...DEFAULT_SUMMARY,
          dataFetchedAt: staleTime,
          lastUpdatedAt: staleTime,
        })
      )
    )
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['journey', 'full', DEFAULT_JOURNEY_ID], {
      ...FULL_JOURNEY,
      summary: { ...DEFAULT_SUMMARY, dataFetchedAt: staleTime },
    })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          initialEntries={[`/journey/${DEFAULT_JOURNEY_ID}/companion`]}
        >
          <Routes>
            <Route path="/journey/:journeyId/companion" element={<CompanionScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText('Möglicherweise veraltet')).toBeTruthy())
  })
})
