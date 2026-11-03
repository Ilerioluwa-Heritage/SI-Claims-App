// The files the app keeps on this device until they're removed: the blank
// HRM-05 and the levels list. Kept in the browser's own storage (IndexedDB);
// nothing is sent anywhere. The monthly files are never kept.

export interface KeptFile {
  fileName: string;
  bytes: Uint8Array;
  /** "YYYY-MM-DD" */
  keptSince: string;
}

const DB = 'si-claims';
const STORE = 'kept';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const getKept = (key: string) => run<KeptFile | undefined>('readonly', (s) => s.get(key));
export const setKept = (key: string, file: KeptFile) => run<void>('readwrite', (s) => s.put(file, key));
export const removeKept = (key: string) => run<void>('readwrite', (s) => s.delete(key));
