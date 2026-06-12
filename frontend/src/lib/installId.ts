import { openDB } from 'idb'

const DB_NAME = 'vb-install'
const STORE = 'kv'
const IDB_KEY = 'install_id'
const LS_KEY = 'vbb_install_id'

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE)
    },
  })
}

/**
 * Returns the persistent install ID for this device, generating one on first call.
 *
 * Resolution order: IndexedDB → localStorage fallback → generate new UUID.
 * Writes back to the other storage when found in one but not the other, keeping them in sync.
 * Never throws — falls back gracefully when IDB is unavailable (e.g. Safari private mode).
 */
export async function getInstallId(): Promise<string> {
  // 1. Try IndexedDB (primary)
  try {
    const db = await getDB()
    const existing: string | undefined = await db.get(STORE, IDB_KEY)
    if (existing) {
      localStorage.setItem(LS_KEY, existing) // keep LS in sync as backup
      return existing
    }
  } catch {
    // IndexedDB unavailable (Safari private, quota exceeded, etc.)
  }

  // 2. Fall back to localStorage
  const lsId = localStorage.getItem(LS_KEY)
  if (lsId) {
    try {
      const db = await getDB()
      await db.put(STORE, lsId, IDB_KEY)
    } catch {}
    return lsId
  }

  // 3. Generate new ID
  const id = crypto.randomUUID()
  try {
    const db = await getDB()
    await db.put(STORE, id, IDB_KEY)
  } catch {}
  localStorage.setItem(LS_KEY, id)
  return id
}
