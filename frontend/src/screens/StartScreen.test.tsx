import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http } from 'msw'
import { server } from '@/test/msw-server'
import { MSW_ERRORS, DEFAULT_JOURNEY_ID } from '@/test/msw-handlers'
import { StartScreen } from './StartScreen'
import '../i18n/index'

const TRAINS_URL = 'http://localhost/v1/trains/:number'

function renderStart() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<StartScreen />} />
          <Route
            path="/journey/:id/alternatives"
            element={<div data-testid="alternatives-page" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('StartScreen', () => {
  it('renders H1 title', () => {
    renderStart()
    expect(screen.getByText(/Schneller ans Ziel/)).toBeTruthy()
  })

  it('submit button is disabled initially', () => {
    renderStart()
    const btn = screen.getByRole('button', { name: /Beste Verbindung/ })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows inline error when train not found on blur', async () => {
    server.use(http.get(TRAINS_URL, () => MSW_ERRORS.trainNotFound()))
    renderStart()
    const trainInput = screen.getByLabelText('Zugnummer')
    await userEvent.type(trainInput, 'ICE999')
    fireEvent.blur(trainInput)
    await waitFor(() => expect(screen.getByText('Zug nicht gefunden für heute')).toBeTruthy())
  })

  it('navigates to alternatives after successful submit', async () => {
    renderStart()
    const user = userEvent.setup()

    const trainInput = screen.getByLabelText('Zugnummer')
    await user.type(trainInput, 'ICE 123')
    fireEvent.blur(trainInput)
    // Wait for validation to clear
    await waitFor(() => expect(screen.queryByText('Zug nicht gefunden für heute')).toBeNull())

    const destInput = screen.getByLabelText('Zielbahnhof')
    await user.type(destInput, 'Fra')
    await waitFor(() => screen.getByText('Frankfurt (Main) Hbf'), { timeout: 1000 })
    fireEvent.click(screen.getByText('Frankfurt (Main) Hbf'))

    const submitBtn = screen.getByRole('button', { name: /Beste Verbindung/ })
    await waitFor(() => expect((submitBtn as HTMLButtonElement).disabled).toBe(false), {
      timeout: 500,
    })

    fireEvent.click(submitBtn)
    await waitFor(() => expect(screen.getByTestId('alternatives-page')).toBeTruthy())
  })

  it('shows plausibility dialog when confidence is not high', async () => {
    const { HttpResponse } = await import('msw')
    server.use(
      http.post('http://localhost/v1/journeys', () =>
        HttpResponse.json(
          {
            journeyId: DEFAULT_JOURNEY_ID,
            plausibility: { onTrainConfidence: 'low', reason: null },
            summary: {
              eta: null,
              status: 'ok',
              timeGainVsOriginalMinutes: null,
              timeGainVsCurrentRouteMinutes: null,
              minTransferBufferMinutes: null,
              criticalTransfer: false,
              alternativeAvailable: false,
              dataConfidence: 'high',
              nextStep: null,
              dataFetchedAt: new Date().toISOString(),
              lastUpdatedAt: new Date().toISOString(),
            },
            alternatives: [],
          },
          { status: 201, headers: { Location: `/v1/journeys/${DEFAULT_JOURNEY_ID}` } }
        )
      )
    )
    renderStart()
    const user = userEvent.setup()

    const trainInput = screen.getByLabelText('Zugnummer')
    await user.type(trainInput, 'ICE 123')
    fireEvent.blur(trainInput)
    await waitFor(() => expect(screen.queryByText('Zug nicht gefunden für heute')).toBeNull())

    const destInput = screen.getByLabelText('Zielbahnhof')
    await user.type(destInput, 'Fra')
    await waitFor(() => screen.getByText('Frankfurt (Main) Hbf'), { timeout: 1000 })
    fireEvent.click(screen.getByText('Frankfurt (Main) Hbf'))

    const submitBtn = screen.getByRole('button', { name: /Beste Verbindung/ })
    await waitFor(() => expect((submitBtn as HTMLButtonElement).disabled).toBe(false), {
      timeout: 500,
    })

    fireEvent.click(submitBtn)
    await waitFor(() => expect(screen.getByText('Ja, Route planen')).toBeTruthy())
  })
})
