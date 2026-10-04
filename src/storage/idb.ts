export const DB_NAME = "marble-melancholy";
export const DB_VERSION = 1;

export type StoreName = "levels" | "drafts";

const STORES: readonly StoreName[] = ["levels", "drafts"];

let dbPromise: Promise<IDBDatabase> | null = null;
let dbName = DB_NAME;

function factory(): IDBFactory {
  const f = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!f) throw new Error("IndexedDB is not available");
  return f;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** Opens (once) and caches the database; creates the `levels` and `drafts` stores on upgrade. */
export function openDb(name = DB_NAME, version = DB_VERSION): Promise<IDBDatabase> {
  if (dbPromise && name === dbName) return dbPromise;
  if (dbPromise) closeDb();
  dbName = name;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory().open(name, version);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        if (dbPromise === p) dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB open blocked by another tab"));
  });
  dbPromise = p;
  p.catch(() => {
    if (dbPromise === p) dbPromise = null;
  });
  return p;
}

async function withStore<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb(dbName);
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result: T;
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return (await withStore(store, "readonly", (s) => s.get(key))) as T | undefined;
}

export async function idbPut<T>(store: StoreName, value: T): Promise<void> {
  await withStore(store, "readwrite", (s) => s.put(value));
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  await withStore(store, "readwrite", (s) => s.delete(key));
}

export async function idbList<T>(store: StoreName): Promise<T[]> {
  return (await withStore(store, "readonly", (s) => s.getAll())) as T[];
}

export function closeDb(): void {
  const p = dbPromise;
  dbPromise = null;
  p?.then((db) => db.close()).catch(() => undefined);
}

/** Close the cached connection and delete the database. */
export async function _resetDbForTests(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) {
    try {
      (await p).close();
    } catch {
      // Opening failed; nothing to close.
    }
  }
  await request(factory().deleteDatabase(dbName));
  dbName = DB_NAME;
}
