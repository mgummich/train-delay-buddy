import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterSheet } from './index'
import { useInstallStore } from '@/store/installStore'
import '../../i18n/index'

beforeEach(() => {
  useInstallStore.setState({
    installId: '',
    filters: { dbOnly: true, maxTransfers: null, safetyLevel: 'normal' },
  })
})

describe('FilterSheet', () => {
  it('renders nothing when closed', () => {
    render(<FilterSheet open={false} onClose={vi.fn()} resultCount={3} />)
    expect(screen.queryByText('Filter')).toBeNull()
  })

  it('shows all 4 filter blocks when open', () => {
    render(<FilterSheet open={true} onClose={vi.fn()} resultCount={3} />)
    expect(screen.getByText('Nur frühere Ankünfte')).toBeTruthy()
    expect(screen.getByText('Verkehrsmittel')).toBeTruthy()
    expect(screen.getByText('Maximale Umstiege')).toBeTruthy()
    expect(screen.getByText('Puffer beim Umstieg')).toBeTruthy()
  })

  it('shows result count on apply button', () => {
    render(<FilterSheet open={true} onClose={vi.fn()} resultCount={5} />)
    expect(screen.getByText('5 Verbindungen anzeigen')).toBeTruthy()
  })

  it('shows no-results message when count is 0', () => {
    render(<FilterSheet open={true} onClose={vi.fn()} resultCount={0} />)
    expect(screen.getByText('Keine Treffer — Suche anpassen')).toBeTruthy()
  })

  it('Nur DB toggle is functional (V1)', () => {
    render(<FilterSheet open={true} onClose={vi.fn()} resultCount={3} />)
    const dbToggle = screen.getByLabelText('Nur DB-Züge')
    expect(dbToggle).not.toBeDisabled()
  })

  it('Maximale Umstiege controls are disabled in V1', () => {
    render(<FilterSheet open={true} onClose={vi.fn()} resultCount={3} />)
    // Segmented buttons for 0/1/2/3/egal should be disabled
    const buttons = screen.getAllByRole('button', { name: /^[0-9]$|^egal$/ })
    buttons.forEach((b) => expect(b).toBeDisabled())
  })
})
