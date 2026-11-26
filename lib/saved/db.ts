/**
 * The app's local database (IndexedDB of this browser — durable site data, not a cache):
 *   saved     — strategies saved from /klines with their backtest result
 *   bars      — candlestick bars, one record per coin + timeframe
 *   barsMeta  — one small row per record of `bars` (so listing them never reads the bars)
 */
const DB_NAME = "indicators";
/** v2: bars are keyed by [symbol, interval] (v1 held a single coin, keyed by interval) */
const DB_VERSION = 2;

export type StoreName = "saved" | "bars" | "barsMeta";

let opening: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("เบราว์เซอร์นี้ไม่รองรับฐานข้อมูลในเครื่อง (IndexedDB)"));
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tx = req.transaction;
        const has = (name: string) => db.objectStoreNames.contains(name);
        if (!has("saved")) db.createObjectStore("saved", { keyPath: "id" });
        if (!has("bars")) db.createObjectStore("bars", { keyPath: ["symbol", "interval"] });
        if (!has("barsMeta")) db.createObjectStore("barsMeta", { keyPath: ["symbol", "interval"] });
        // v1 stores: move what they hold into the new ones (same record shape), then drop them
        for (const [from, to] of [["klines", "bars"], ["klineMeta", "barsMeta"]] as const) {
          if (!tx || !has(from)) continue;
          const all = tx.objectStore(from).getAll();
          all.onsuccess = () => {
            for (const rec of all.result) tx.objectStore(to).put(rec);
            db.deleteObjectStore(from);
          };
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgrading the database must not be blocked by this one
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("เปิดฐานข้อมูลในเครื่องไม่ได้"));
      req.onblocked = () => reject(new Error("ฐานข้อมูลถูกใช้งานโดยแท็บอื่น ลองปิดแท็บอื่นแล้วเปิดใหม่"));
    });
    opening.catch(() => { opening = null; });
  }
  return opening;
}

/** Run one transaction over `stores`; resolves with whatever `work` returned once it has committed */
export async function transact<T>(
  stores: StoreName[], mode: IDBTransactionMode, work: (get: (name: StoreName) => IDBObjectStore) => T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let out: T;
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error ?? new Error("บันทึกลงฐานข้อมูลในเครื่องไม่สำเร็จ"));
    tx.onabort = () => reject(tx.error ?? new Error("บันทึกลงฐานข้อมูลในเครื่องไม่สำเร็จ (พื้นที่อาจเต็ม)"));
    try {
      out = work((name) => tx.objectStore(name));
    } catch (err) {
      tx.abort();
      reject(err);
    }
  });
}

export async function dbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const req = await transact([store], "readonly", (s) => s(store).get(key));
  return req.result as T | undefined;
}

export async function dbGetAll<T>(store: StoreName): Promise<T[]> {
  const req = await transact([store], "readonly", (s) => s(store).getAll());
  return req.result as T[];
}

export async function dbPut(store: StoreName, value: unknown): Promise<void> {
  await transact([store], "readwrite", (s) => { s(store).put(value); });
}

export async function dbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  await transact([store], "readwrite", (s) => { s(store).delete(key); });
}
