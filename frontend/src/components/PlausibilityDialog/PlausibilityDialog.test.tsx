import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlausibilityDialog } from './index'
import '../../i18n/index'

describe('PlausibilityDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PlausibilityDialog open={false} onConfirm={vi.fn()} onDeny={vi.fn()} />
      </MemoryRouter>
    )
    expect(screen.queryByText('Ja, Route planen')).toBeNull()
  })

  it('shows dialog when open=true', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PlausibilityDialog open={true} onConfirm={vi.fn()} onDeny={vi.fn()} />
      </MemoryRouter>
    )
    expect(screen.getByText('Ja, Route planen')).toBeTruthy()
    expect(screen.getByText('Nein, ich sitze nicht in diesem Zug')).toBeTruthy()
  })

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn()
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PlausibilityDialog open={true} onConfirm={onConfirm} onDeny={vi.fn()} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('Ja, Route planen'))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onDeny when deny button clicked', () => {
    const onDeny = vi.fn()
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PlausibilityDialog open={true} onConfirm={vi.fn()} onDeny={onDeny} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('Nein, ich sitze nicht in diesem Zug'))
    expect(onDeny).toHaveBeenCalledOnce()
  })
})
