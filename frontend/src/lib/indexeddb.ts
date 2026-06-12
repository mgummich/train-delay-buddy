import { openDB } from 'idb'

/** Increment when the JourneyCache shape changes to invalidate stale IDB entries on next load. */
export const SCHEMA_VERSION = 1

/** Shape of the active-journey record stored in IndexedDB under key `"active"`. */
export interface JourneyCache {
  schemaVersion: number
  journeyId: string
  etag: string | null
  summary: unknown
  savedAt: string
}

const DB_NAME = 'vb-app'
const JOURNEY_STORE = 'journey'
const ACTIVE_KEY = 'active'

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(JOURNEY_STORE)
    },
  })
}

/** Persists the active journey to IndexedDB, stamping the current schema version. */
export async function saveJourney(data: Omit<JourneyCache, 'schemaVersion'>): Promise<void> {
  const db = await getDB()
  await db.put(JOURNEY_STORE, { ...data, schemaVersion: SCHEMA_VERSION }, ACTIVE_KEY)
}

/**
 * Loads the active journey from IndexedDB.
 * Returns null if nothing is stored or the schema version is outdated (entry is deleted).
 */
export async function loadJourney(): Promise<JourneyCache | null> {
  const db = await getDB()
  const raw: JourneyCache | undefined = await db.get(JOURNEY_STORE, ACTIVE_KEY)
  if (!raw) return null
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    await db.delete(JOURNEY_STORE, ACTIVE_KEY)
    return null
  }
  return raw
}

/** Removes the active journey record from IndexedDB (called on journey termination). */
export async function clearJourney(): Promise<void> {
  const db = await getDB()
  await db.delete(JOURNEY_STORE, ACTIVE_KEY)
}
