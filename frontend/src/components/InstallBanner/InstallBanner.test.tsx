import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InstallBanner } from './index'

describe('InstallBanner', () => {
  beforeEach(() => {
    localStorage.removeItem('vb-install-dismissed')
  })

  it('renders nothing when in standalone mode', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches:             query === '(display-mode: standalone)',
        media:               query,
        onchange:            null,
        addListener:         vi.fn(),
        removeListener:      vi.fn(),
        addEventListener:    vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent:       vi.fn(),
      })),
    })
    render(<InstallBanner />)
    expect(screen.queryByText(/installieren|hinzufügen/i)).toBeNull()
  })

  it('hides after dismiss and saves snooze to localStorage', () => {
    const { container } = render(<InstallBanner forceShow />)
    const dismissBtn = container.querySelector('[aria-label="Banner schließen"]') as HTMLElement
    expect(dismissBtn).toBeTruthy()
    fireEvent.click(dismissBtn)
    expect(screen.queryByText(/installieren|hinzufügen/i)).toBeNull()
    expect(localStorage.getItem('vb-install-dismissed')).toBeTruthy()
  })
})
