// ─── IndexedDB wrapper ────────────────────────────────────────────────────────
// Thin typed layer over the browser IndexedDB API.
// All page components interact with this instead of IDB directly.

const DB_NAME = 'kolondiro_os'
// Bump version when adding new stores; existing data stays intact
const DB_VERSION = 2

const STORES = [
  'orders',
  'order_items',
  'till_sessions',
  'payouts',
  'menu_items',
  'menu_categories',
  'menu_item_zone_prices',
  'tables',
  'profiles',
  'zone_assignments',
  'inventory',
  'credentials',
  'sync_queue',
] as const

export type StoreName = (typeof STORES)[number]

export interface SyncQueueEntry {
  id: string
  table_name: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  record_id: string
  payload: Record<string, unknown>
  created_at: string
  retries: number
}

export interface CredentialRecord {
  id: string
  email?: string
  full_name: string
  role: string
  mode: 'pin' | 'password'
  verifier: string
  created_at?: string
  stored_at: string
}

let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      _db = req.result
      resolve(_db)
    }
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      })
    }
  })
}

export async function localGet<T = Record<string, unknown>>(
  storeName: StoreName,
  id: string
): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(id)
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

export async function localGetAll<T = Record<string, unknown>>(
  storeName: StoreName,
  filterKey?: keyof T,
  filterValue?: unknown
): Promise<T[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
    req.onsuccess = () => {
      let results = (req.result ?? []) as T[]
      if (filterKey !== undefined && filterValue !== undefined) {
        results = results.filter((r) => r[filterKey] === filterValue)
      }
      resolve(results)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function localPut<T extends { id: string }>(
  storeName: StoreName,
  record: T
): Promise<IDBValidKey> {
  // Guard: never attempt to store a record without an id — IDB will throw DataError
  if (!record.id) {
    console.warn(`[localPut] Skipping ${storeName} record with missing id`, record)
    return ''
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).put(record)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function localDelete(storeName: StoreName, id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function localBulkPut<T extends { id: string }>(
  storeName: StoreName,
  records: T[]
): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    records.forEach((r) => store.put(r))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Sync queue helpers ────────────────────────────────────────────────────────

export async function queueSync(
  tableName: string,
  operation: SyncQueueEntry['operation'],
  recordId: string,
  payload: Record<string, unknown>
): Promise<SyncQueueEntry> {
  const entry: SyncQueueEntry = {
    id: crypto.randomUUID(),
    table_name: tableName,
    operation,
    record_id: recordId,
    payload,
    created_at: new Date().toISOString(),
    retries: 0,
  }
  await localPut('sync_queue', entry)
  return entry
}

export async function getPendingQueue(): Promise<SyncQueueEntry[]> {
  const all = await localGetAll<SyncQueueEntry>('sync_queue')
  return all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

export async function removeFromQueue(id: string): Promise<void> {
  await localDelete('sync_queue', id)
}

export async function getPendingCount(): Promise<number> {
  return (await getPendingQueue()).length
}

// ── Credential helpers (offline auth cache) ───────────────────────────────────

export async function saveCredential(record: CredentialRecord): Promise<IDBValidKey> {
  return localPut('credentials', record)
}

export async function getCredentials(): Promise<CredentialRecord[]> {
  return localGetAll<CredentialRecord>('credentials')
}
