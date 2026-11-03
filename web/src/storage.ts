// What the app keeps on this device until it's removed: the blank HRM-05, and
// the people from the levels list (name, student number and level only, never
// the uploaded file itself). Kept in the browser's own storage (IndexedDB);
// nothing is sent anywhere. The monthly files are never kept.

import type { RosterPerson } from '../../src/core/names.ts';

export interface KeptFile {
  fileName: string;
  bytes: Uint8Array;
  /** "YYYY-MM-DD" */
  keptSince: string;
}

export interface KeptList {
  fileName: string;
  keptSince: string;
  people: RosterPerson[];
  problems: string[];
}

interface Kept {
  claimForm: KeptFile;
  levels: KeptList;
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

export const getKept = <K extends keyof Kept>(key: K) => run<Kept[K] | undefined>('readonly', (s) => s.get(key));
export const setKept = <K extends keyof Kept>(key: K, value: Kept[K]) => run<void>('readwrite', (s) => s.put(value, key));
export const removeKept = (key: keyof Kept) => run<void>('readwrite', (s) => s.delete(key));
