import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Node } from './Node'
import { TransferBlock } from './TransferBlock'
import { LegBlock } from './LegBlock'
import '../../i18n/index'

describe('Node', () => {
  it('renders past node with aria-hidden', () => {
    const { container } = render(<Node kind="past" />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
    expect(container.firstChild).toHaveAttribute('tabindex', '-1')
  })

  it('renders current node with aria-current', () => {
    const { container } = render(<Node kind="current" />)
    expect(container.firstChild).toHaveAttribute('aria-current', 'step')
    expect(container.firstChild).toHaveAttribute('tabindex', '0')
  })

  it('renders future node as focusable', () => {
    const { container } = render(<Node kind="future" />)
    expect(container.firstChild).toHaveAttribute('tabindex', '0')
  })

  it('applies vb-pulse class to current node', () => {
    const { container } = render(<Node kind="current" />)
    expect(container.querySelector('.vb-pulse')).toBeTruthy()
  })
})

describe('TransferBlock', () => {
  it('renders OK transfer with accent bg', () => {
    const { container } = render(
      <MemoryRouter>
        <TransferBlock bufferMinutes={9} nextTrain="RE 4321" nextPlatform="5" critical={false} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Umstieg · Puffer 9 Min/)).toBeTruthy()
    expect(screen.getByText(/RE 4321/)).toBeTruthy()
    expect(container.querySelector('.bg-accent-soft')).toBeTruthy()
  })

  it('renders critical transfer with warn bg and link', () => {
    render(
      <MemoryRouter>
        <TransferBlock bufferMinutes={2} nextTrain="ICE 1573" nextPlatform="1" critical={true} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Umstieg kritisch/)).toBeTruthy()
    const link = screen.getByRole('button', { name: /Alternative ansehen/ })
    expect(link).toBeTruthy()
  })
})

describe('LegBlock', () => {
  it('renders line name and direction', () => {
    render(
      <LegBlock line="ICE 1045" direction="Richtung Hamburg-Altona" duration="1:04 h" current={false} />,
    )
    expect(screen.getByText('ICE 1045')).toBeTruthy()
    expect(screen.getByText('Richtung Hamburg-Altona')).toBeTruthy()
  })

  it('shows blinking live badge when current', () => {
    const { container } = render(
      <LegBlock line="ICE 1045" direction="Hamburg" duration="1:04 h" current={true} />,
    )
    expect(container.querySelector('.vb-blink')).toBeTruthy()
    expect(screen.getByText(/Jetzt unterwegs/)).toBeTruthy()
  })
})
