import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterRow } from './index'
import '../../i18n/index'

describe('FilterRow', () => {
  it('shows filter button', () => {
    render(
      <FilterRow activeFilters={[]} onOpenFilter={vi.fn()} onRemoveFilter={vi.fn()} />
    )
    expect(screen.getByText('Filter')).toBeTruthy()
  })

  it('shows count badge when filters active', () => {
    render(
      <FilterRow
        activeFilters={[{ key: 'dbOnly', label: 'Nur DB' }]}
        onOpenFilter={vi.fn()}
        onRemoveFilter={vi.fn()}
      />
    )
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('shows active filter chip with × button', () => {
    render(
      <FilterRow
        activeFilters={[{ key: 'dbOnly', label: 'Nur DB' }]}
        onOpenFilter={vi.fn()}
        onRemoveFilter={vi.fn()}
      />
    )
    expect(screen.getByText('Nur DB')).toBeTruthy()
    // × button exists
    expect(screen.getAllByRole('button').length).toBeGreaterThan(1)
  })

  it('calls onRemoveFilter when × clicked', () => {
    const onRemove = vi.fn()
    render(
      <FilterRow
        activeFilters={[{ key: 'dbOnly', label: 'Nur DB' }]}
        onOpenFilter={vi.fn()}
        onRemoveFilter={onRemove}
      />
    )
    // The × button is the second button (after Filter button)
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1]!)
    expect(onRemove).toHaveBeenCalledWith('dbOnly')
  })
})
