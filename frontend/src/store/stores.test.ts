import { describe, it, expect, beforeEach } from 'vitest'
import { useJourneyStore } from './journeyStore'
import { useInstallStore } from './installStore'
import { useUIStore } from './uiStore'

// Reset Zustand stores between tests
beforeEach(() => {
  useJourneyStore.setState({
    journeyId: null, etag: null, status: null, alternativeAvailable: false,
  })
  useUIStore.setState({ confirmDialogOpen: false, toasts: [] })
})

describe('journeyStore', () => {
  it('starts with null journeyId', () => {
    expect(useJourneyStore.getState().journeyId).toBeNull()
  })

  it('setJourney stores id and etag', () => {
    useJourneyStore.getState().setJourney('jrn_abc', '"etag:1"')
    const { journeyId, etag } = useJourneyStore.getState()
    expect(journeyId).toBe('jrn_abc')
    expect(etag).toBe('"etag:1"')
  })

  it('clearJourney resets all fields', () => {
    useJourneyStore.getState().setJourney('jrn_abc', '"etag:1"')
    useJourneyStore.getState().clearJourney()
    expect(useJourneyStore.getState().journeyId).toBeNull()
    expect(useJourneyStore.getState().etag).toBeNull()
  })

  it('setStatus updates status and alternativeAvailable', () => {
    useJourneyStore.getState().setStatus('critical', true)
    expect(useJourneyStore.getState().status).toBe('critical')
    expect(useJourneyStore.getState().alternativeAvailable).toBe(true)
  })
})

describe('installStore', () => {
  it('default filters have dbOnly: true', () => {
    expect(useInstallStore.getState().filters.dbOnly).toBe(true)
  })

  it('setFilters merges partial update', () => {
    useInstallStore.getState().setFilters({ dbOnly: false })
    expect(useInstallStore.getState().filters.dbOnly).toBe(false)
    expect(useInstallStore.getState().filters.safetyLevel).toBe('normal')
  })
})

describe('uiStore', () => {
  it('addToast appends with unique id', () => {
    useUIStore.getState().addToast('Something went wrong')
    const { toasts } = useUIStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.message).toBe('Something went wrong')
    expect(toasts[0]?.id).toBeTruthy()
  })

  it('removeToast removes by id', () => {
    useUIStore.getState().addToast('Error A')
    useUIStore.getState().addToast('Error B')
    const id = useUIStore.getState().toasts[0]!.id
    useUIStore.getState().removeToast(id)
    expect(useUIStore.getState().toasts).toHaveLength(1)
    expect(useUIStore.getState().toasts[0]?.message).toBe('Error B')
  })
})
