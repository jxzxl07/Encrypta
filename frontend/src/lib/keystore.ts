/**
 * Keeps the unlocked identity key across page reloads.
 *
 * IndexedDB can hold a CryptoKey object directly. Because the key was imported
 * as non-extractable, what is stored is a handle the browser will use but
 * never reveal, not the key bytes.
 */
const DB = 'encrypta'
const STORE = 'identity'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const conn = await db()
  return new Promise((resolve, reject) => {
    const req = fn(conn.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface StoredIdentity {
  userId: string
  privateKey: CryptoKey
  publicKey: string
}

export const saveIdentity = (id: StoredIdentity) => tx('readwrite', (s) => s.put(id, 'current'))
export const loadIdentity = () => tx<StoredIdentity | undefined>('readonly', (s) => s.get('current'))
export const clearIdentity = () => tx('readwrite', (s) => s.delete('current'))
