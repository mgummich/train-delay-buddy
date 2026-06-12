import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY } from '@/test/msw-handlers'
import { AlternativesScreen } from './AlternativesScreen'
import '../i18n/index'

// Journey schema (GET /journeys/{id}) has NO alternatives field per openapi spec.
const JOURNEY_DATA = {
  journeyId: DEFAULT_JOURNEY_ID,
  summary:   DEFAULT_SUMMARY,
  legs:      [],
  stops:     [],
}

// Alternatives come from GET /journeys/{id}/alternatives — Alternative has nested summary.
const ALTS_DATA = {
  data: [
    {
      journeyId: 'jrn_alt01234567890a',
      summary: { ...DEFAULT_SUMMARY, timeGainVsOriginalMinutes: 18, eta: '2026-06-11T17:24:00Z', minTransferBufferMinutes: 3 },
      legs: [],
    },
    {
      journeyId: 'jrn_alt01234567890b',
      summary: { ...DEFAULT_SUMMARY, timeGainVsOriginalMinutes: 12, eta: '2026-06-11T17:30:00Z', minTransferBufferMinutes: 11 },
      legs: [],
    },
  ],
  totalCount: 2,
}

function renderAlternatives(journeyId = DEFAULT_JOURNEY_ID) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['journey', 'full',         journeyId], JOURNEY_DATA)
  qc.setQueryData(['journey', 'alternatives', journeyId], ALTS_DATA)

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/journey/${journeyId}/alternatives`]}>
        <Routes>
          <Route path="/journey/:journeyId/alternatives" element={<AlternativesScreen />} />
          <Route path="/journey/:journeyId/companion" element={<div data-testid="companion" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('AlternativesScreen', () => {
  it('renders heading', async () => {
    renderAlternatives()
    await waitFor(() =>
      expect(screen.getByText('Bessere Verbindungen gefunden')).toBeTruthy()
    )
  })

  it('renders alternative cards', async () => {
    renderAlternatives()
    await waitFor(() => expect(screen.getByText('+18 Min')).toBeTruthy())
    expect(screen.getByText('+12 Min')).toBeTruthy()
  })

  it('shows 3 skeleton cards while loading', async () => {
    // Don't pre-seed cache — let it fetch
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/journey/${DEFAULT_JOURNEY_ID}/alternatives`]}>
          <Routes>
            <Route path="/journey/:journeyId/alternatives" element={<AlternativesScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    // Immediately visible skeleton cards
    const skeletons = document.querySelectorAll('[aria-hidden="true"]')
    expect(skeletons.length).toBeGreaterThanOrEqual(3)
  })

  it('navigates to companion on card select', async () => {
    renderAlternatives()
    await waitFor(() => screen.getByText('+18 Min'))
    // SubAppBar back + settings buttons come before alt cards, so find first card button
    const altCardBtn = screen.getAllByRole('button').find(
      (b) => b.closest('[class*="rounded-card"]') !== null
    )!
    fireEvent.click(altCardBtn)
    await waitFor(() => expect(screen.getByTestId('companion')).toBeTruthy())
  })

  it('shows Leer state when no alternatives', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['journey', 'full',         DEFAULT_JOURNEY_ID], JOURNEY_DATA)
    qc.setQueryData(['journey', 'alternatives', DEFAULT_JOURNEY_ID], { data: [], totalCount: 0 })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/journey/${DEFAULT_JOURNEY_ID}/alternatives`]}>
          <Routes>
            <Route path="/journey/:journeyId/alternatives" element={<AlternativesScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(screen.getByText('Aktuell keine schnellere Verbindung')).toBeTruthy()
    )
  })

  it('shows filter count badge when DB-only is ON', async () => {
    renderAlternatives()
    await waitFor(() => screen.getByText('+18 Min'))
    // DB-only is default ON → filter chip shows
    expect(screen.getByText('Nur DB')).toBeTruthy()
  })
})
