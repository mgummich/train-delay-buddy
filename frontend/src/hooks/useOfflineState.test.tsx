import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React, { Suspense } from 'react'
import { IDBFactory } from 'fake-indexeddb'
import {
  OfflineStateLoader,
  _resetHydrationPromiseForTests,
  _setHydrationPromiseForTests,
} from '@/components/OfflineStateLoader'
import { createOfflineStatePromise } from '@/hooks/useOfflineState'
import { useJourneyStore } from '@/store/journeyStore'
import { saveJourney } from '@/lib/indexeddb'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  useJourneyStore.setState({
    journeyId: null,
    etag: null,
    status: null,
    alternativeAvailable: false,
  })
  _resetHydrationPromiseForTests()
})

function TestChild() {
  const { journeyId } = useJourneyStore()
  return <div data-testid="journey-id">{journeyId ?? 'none'}</div>
}

describe('OfflineStateLoader', () => {
  it('renders children without hydrating when IndexedDB is empty', async () => {
    // Pre-resolve the hydration promise (IDB is empty) before rendering
    const p = createOfflineStatePromise()
    await p
    _setHydrationPromiseForTests(p)

    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <OfflineStateLoader>
            <TestChild />
          </OfflineStateLoader>
        </Suspense>
      )
    })

    expect(screen.getByTestId('journey-id').textContent).toBe('none')
  })

  it('hydrates journeyStore from IndexedDB before rendering children', async () => {
    await saveJourney({
      journeyId: 'jrn_cached01234567',
      etag: '"cached:epoch:1"',
      summary: {},
      savedAt: new Date().toISOString(),
    })

    // Pre-resolve the hydration promise (IDB has data) before rendering
    const p = createOfflineStatePromise()
    await p
    _setHydrationPromiseForTests(p)

    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <OfflineStateLoader>
            <TestChild />
          </OfflineStateLoader>
        </Suspense>
      )
    })

    expect(screen.getByTestId('journey-id').textContent).toBe('jrn_cached01234567')
  })
})
