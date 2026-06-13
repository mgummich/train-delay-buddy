import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SummaryHeader } from './index'
import { buildSummary, buildCriticalSummary } from '@/test/factories'
import type { JourneySummary } from '@/api/validation'
import '../../i18n/index'

describe('SummaryHeader', () => {
  it('renders time gain and ETA', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SummaryHeader
          summary={buildSummary() as JourneySummary}
          tab="timeline"
          onTabChange={() => {}}
        />
      </MemoryRouter>
    )
    expect(screen.getByText(/18 Min/)).toBeTruthy()
    // ETA 2026-06-11T17:24:00Z = 19:24 Berlin (CEST). Use testId — ETA also appears in the
    // visible paragraph ("Ankunft 19:24"), so getByText would be ambiguous.
    expect(screen.getByTestId('eta').textContent).toBe('19:24')
  })

  it('has aria-live="polite" on the ETA region', () => {
    const { container } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SummaryHeader
          summary={buildSummary() as JourneySummary}
          tab="timeline"
          onTabChange={() => {}}
        />
      </MemoryRouter>
    )
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy()
  })

  it('shows inline staleness badge when dataFetchedAt is 31–119 seconds ago', () => {
    // 0.5 min < ageMin < 2 min → "Möglicherweise veraltet" inline badge
    const staleTime = new Date(Date.now() - 90 * 1000).toISOString()
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SummaryHeader
          summary={buildSummary({ dataFetchedAt: staleTime }) as JourneySummary}
          tab="timeline"
          onTabChange={() => {}}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('Möglicherweise veraltet')).toBeTruthy()
  })

  it('shows full staleness banner when dataFetchedAt is >= 2 minutes ago', () => {
    // ageMin >= 2 → "Daten veraltet – kein Netz?" banner card
    const staleTime = new Date(Date.now() - 4 * 60 * 1000).toISOString()
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SummaryHeader
          summary={buildSummary({ dataFetchedAt: staleTime }) as JourneySummary}
          tab="timeline"
          onTabChange={() => {}}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('Daten veraltet – kein Netz?')).toBeTruthy()
  })

  it('renders role="alert" when status is critical', () => {
    const { container } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SummaryHeader
          summary={buildCriticalSummary() as JourneySummary}
          tab="timeline"
          onTabChange={() => {}}
        />
      </MemoryRouter>
    )
    expect(container.querySelector('[role="alert"]')).toBeTruthy()
  })

  it('renders Timeline and Karte tab buttons', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SummaryHeader
          summary={buildSummary() as JourneySummary}
          tab="timeline"
          onTabChange={() => {}}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('Timeline')).toBeTruthy()
    expect(screen.getByText('Karte')).toBeTruthy()
  })
})
