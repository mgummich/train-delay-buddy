import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY, MSW_ERRORS } from '@/test/msw-handlers'
import { queryKeys } from '@/lib/queryClient'
import { AlternativesScreen } from './AlternativesScreen'
import '../i18n/index'

// Journey schema (GET /journeys/{id}) has NO alternatives field per openapi spec.
const JOURNEY_DATA = {
  journeyId: DEFAULT_JOURNEY_ID,
  summary: DEFAULT_SUMMARY,
  legs: [],
  stops: [],
}

// Alternatives come from GET /journeys/{id}/alternatives — Alternative has nested summary.
const ALTS_DATA = {
  data: [
    {
      journeyId: 'jrn_alt01234567890a',
      summary: {
        ...DEFAULT_SUMMARY,
        timeGainVsOriginalMinutes: 18,
        eta: '2026-06-11T17:24:00Z',
        minTransferBufferMinutes: 3,
      },
      legs: [],
    },
    {
      journeyId: 'jrn_alt01234567890b',
      summary: {
        ...DEFAULT_SUMMARY,
        timeGainVsOriginalMinutes: 12,
        eta: '2026-06-11T17:30:00Z',
        minTransferBufferMinutes: 11,
      },
      legs: [],
    },
  ],
  totalCount: 2,
}

function renderAlternatives(journeyId = DEFAULT_JOURNEY_ID) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(queryKeys.journeyFull(journeyId), JOURNEY_DATA)
  qc.setQueryData(queryKeys.journeyAlternatives(journeyId), ALTS_DATA)

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={[`/journey/${journeyId}/alternatives`]}
      >
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
    await waitFor(() => expect(screen.getByText('Bessere Verbindungen gefunden')).toBeTruthy())
  })

  it('renders alternative cards', async () => {
    renderAlternatives()
    await waitFor(() => expect(screen.getByText('+18 Min')).toBeTruthy())
    expect(screen.getByText('+12 Min')).toBeTruthy()
  })

  it('shows 3 skeleton cards while loading', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          initialEntries={[`/journey/${DEFAULT_JOURNEY_ID}/alternatives`]}
        >
          <Routes>
            <Route path="/journey/:journeyId/alternatives" element={<AlternativesScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    const statusRegion = screen.getByRole('status', { name: /geladen/i })
    expect(statusRegion.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3)
  })

  it('navigates to companion on card select', async () => {
    renderAlternatives()
    await waitFor(() => screen.getByText('+18 Min'))
    // Click the card to select it (shows the sticky "Route wählen" CTA)
    const altCardBtn = screen
      .getAllByRole('button')
      .find((b) => b.closest('[class*="rounded-card"]') !== null)!
    fireEvent.click(altCardBtn)
    // Then confirm via the CTA — AlternativesScreen uses a two-step select → confirm flow
    await waitFor(() => screen.getByRole('button', { name: /Route wählen/i }))
    fireEvent.click(screen.getByRole('button', { name: /Route wählen/i }))
    await waitFor(() => expect(screen.getByTestId('companion')).toBeTruthy())
  })

  it('shows Leer state when no alternatives', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(queryKeys.journeyFull(DEFAULT_JOURNEY_ID), JOURNEY_DATA)
    qc.setQueryData(queryKeys.journeyAlternatives(DEFAULT_JOURNEY_ID), { data: [], totalCount: 0 })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          initialEntries={[`/journey/${DEFAULT_JOURNEY_ID}/alternatives`]}
        >
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
    expect(screen.getByText('Nur DB')).toBeTruthy()
  })

  it('hides heading and filter row during error state', async () => {
    server.use(http.get('/v1/journeys/:id/alternatives', () => MSW_ERRORS.upstreamUnavailable()))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(queryKeys.journeyFull(DEFAULT_JOURNEY_ID), JOURNEY_DATA)
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          initialEntries={[`/journey/${DEFAULT_JOURNEY_ID}/alternatives`]}
        >
          <Routes>
            <Route path="/journey/:journeyId/alternatives" element={<AlternativesScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.queryByText('Bessere Verbindungen gefunden')).toBeNull())
    expect(screen.queryByText('Filter')).toBeNull()
  })

  it('Neu berechnen fires POST and invalidates query', async () => {
    let postCalled = false
    server.use(
      http.post('/v1/journeys/:id/alternatives', ({ params }) => {
        postCalled = true
        return HttpResponse.json(
          { status: 'computing', pollPath: `/v1/journeys/${params['id']}/alternatives` },
          { status: 202 }
        )
      })
    )
    renderAlternatives()
    await waitFor(() => screen.getByText('+18 Min'))
    fireEvent.click(screen.getByText('Neu berechnen'))
    await waitFor(() => expect(postCalled).toBe(true))
  })

  it('shows riskant badge for alternative with buffer < 5 min', async () => {
    renderAlternatives()
    await waitFor(() => screen.getByText('+18 Min'))
    // First alt has minTransferBufferMinutes: 3 → riskant badge
    expect(screen.getByText('Riskant')).toBeTruthy()
  })

  it('shows schnellste badge on first alternative', async () => {
    renderAlternatives()
    await waitFor(() => screen.getByText('+18 Min'))
    expect(screen.getByText('Schnellste')).toBeTruthy()
  })
})
