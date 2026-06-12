import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { saveJourney, loadJourney, clearJourney, SCHEMA_VERSION } from './indexeddb'

const SAMPLE = {
  journeyId: 'jrn_01j2k3m4n5p6',
  etag: '"jrn_01j2k3m4n5p6:epoch:42"',
  summary: { eta: '2026-06-11T17:24:00Z', status: 'ok' },
  savedAt: '2026-06-11T15:00:00Z',
}

describe('indexeddb journey cache', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it('returns null when nothing saved', async () => {
    expect(await loadJourney()).toBeNull()
  })

  it('saves and loads journey', async () => {
    await saveJourney(SAMPLE)
    const loaded = await loadJourney()
    expect(loaded?.journeyId).toBe(SAMPLE.journeyId)
    expect(loaded?.etag).toBe(SAMPLE.etag)
    expect(loaded?.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('drops entry when schemaVersion mismatches', async () => {
    await saveJourney(SAMPLE)
    // Simulate old schema version by patching the stored value directly
    const { openDB } = await import('idb')
    const db = await openDB('vb-app', 1)
    await db.put('journey', { ...SAMPLE, schemaVersion: 0 }, 'active')
    db.close()

    const loaded = await loadJourney()
    expect(loaded).toBeNull()
  })

  it('clearJourney removes the entry', async () => {
    await saveJourney(SAMPLE)
    await clearJourney()
    expect(await loadJourney()).toBeNull()
  })
})
