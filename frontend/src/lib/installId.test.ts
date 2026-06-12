import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { getInstallId } from './installId'

describe('getInstallId', () => {
  beforeEach(() => {
    localStorage.clear()
    // Replace with a fresh IDBFactory so each test starts with empty databases
    globalThis.indexedDB = new IDBFactory()
  })

  it('generates a UUID v4 on first call', async () => {
    const id = await getInstallId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('returns the same id on subsequent calls', async () => {
    const id1 = await getInstallId()
    const id2 = await getInstallId()
    expect(id1).toBe(id2)
  })

  it('returns localStorage value if IndexedDB is empty', async () => {
    const stored = '550e8400-e29b-41d4-a716-446655440000'
    localStorage.setItem('vbb_install_id', stored)
    const id = await getInstallId()
    expect(id).toBe(stored)
  })

  it('backfills localStorage from IndexedDB value', async () => {
    const id = await getInstallId()
    expect(localStorage.getItem('vbb_install_id')).toBe(id)
  })
})
