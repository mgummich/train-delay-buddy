import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlternativeCard } from './index'
import '../../i18n/index'

const CARD_DATA = {
  journeyId: 'jrn_alt01234567890',
  timeGainMin: 18,
  eta: '2026-06-11T17:24:00Z',
  transfers: 2,
  minBuffer: 3,
  badges: ['riskant' as const, 'schnellste' as const],
  recommended: true,
}

describe('AlternativeCard', () => {
  it('renders time gain prominently', () => {
    render(<AlternativeCard {...CARD_DATA} onSelect={vi.fn()} />)
    expect(screen.getByText('+18 Min')).toBeTruthy()
  })

  it('shows arrival time and transfer count', () => {
    render(<AlternativeCard {...CARD_DATA} onSelect={vi.fn()} />)
    expect(screen.getByText(/19:24/)).toBeTruthy()
    expect(screen.getByText(/2 Umstiege/)).toBeTruthy()
  })

  it('shows Riskant badge', () => {
    render(<AlternativeCard {...CARD_DATA} onSelect={vi.fn()} />)
    expect(screen.getByText('Riskant')).toBeTruthy()
  })

  it('calls onSelect when tapped', () => {
    const onSelect = vi.fn()
    render(<AlternativeCard {...CARD_DATA} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith(CARD_DATA.journeyId)
  })

  it('applies accent border when recommended', () => {
    const { container } = render(<AlternativeCard {...CARD_DATA} onSelect={vi.fn()} />)
    expect(container.querySelector('.border-accent')).toBeTruthy()
  })
})
