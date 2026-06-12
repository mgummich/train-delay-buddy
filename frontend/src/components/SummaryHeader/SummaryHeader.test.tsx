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
      <MemoryRouter>
        <SummaryHeader
          summary={buildSummary() as JourneySummary}
          tab="timeline"
          onTabChange={() => {}}
        />
      </MemoryRouter>
    )
    expect(screen.getByText(/18 Min/)).toBeTruthy()
    // ETA 2026-06-11T17:24:00Z = 19:24 Berlin (CEST)
    expect(screen.getByText(/19:24/)).toBeTruthy()
  })

  it('has aria-live="polite" on the ETA region', () => {
    const { container } = render(
      <MemoryRouter>
        <SummaryHeader
          summary={buildSummary() as JourneySummary}
          tab="timeline"
          onTabChange={() => {}}
        />
      </MemoryRouter>
    )
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy()
  })

  it('shows staleness badge when dataFetchedAt > 3 minutes ago', () => {
    const staleTime = new Date(Date.now() - 4 * 60 * 1000).toISOString()
    render(
      <MemoryRouter>
        <SummaryHeader
          summary={buildSummary({ dataFetchedAt: staleTime }) as JourneySummary}
          tab="timeline"
          onTabChange={() => {}}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('Möglicherweise veraltet')).toBeTruthy()
  })

  it('renders role="alert" when status is critical', () => {
    const { container } = render(
      <MemoryRouter>
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
      <MemoryRouter>
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
