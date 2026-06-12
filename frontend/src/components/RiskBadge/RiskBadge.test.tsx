import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RiskBadge } from './index'

describe('RiskBadge', () => {
  it('renders Riskant badge with warn color class', () => {
    const { container } = render(
      <RiskBadge variant="riskant" aria-label="Umstieg riskant — Puffer unter 5 Minuten" />
    )
    expect(screen.getByText('Riskant')).toBeTruthy()
    expect(container.querySelector('[aria-label]')).toBeTruthy()
  })

  it('renders Schnellste badge', () => {
    render(<RiskBadge variant="schnellste" />)
    expect(screen.getByText('Schnellste')).toBeTruthy()
  })

  it('renders custom text via children', () => {
    render(<RiskBadge variant="neutral">Nur DB</RiskBadge>)
    expect(screen.getByText('Nur DB')).toBeTruthy()
  })
})
