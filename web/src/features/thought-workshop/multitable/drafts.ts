import type { Operation } from "./api";
export type TableDraft = {
  key: string;
  document: string;
  tab: string;
  revision: number;
  operations: Operation[];
  time: number;
};
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("fpl-multitable-drafts", 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore("drafts", { keyPath: "key" });
      s.createIndex("document", "document");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function access<T>(
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode),
      req = work(tx.objectStore("drafts"));
    tx.oncomplete = () => {
      resolve(req.result);
      db.close();
    };
    tx.onerror = () => {
      reject(tx.error);
      db.close();
    };
    tx.onabort = () => {
      reject(tx.error);
      db.close();
    };
  });
}
export const drafts = (document: string) =>
  access("readonly", (s) => s.index("document").getAll(document)) as Promise<
    TableDraft[]
  >;
export const putDraft = (value: TableDraft) =>
  access("readwrite", (s) => s.put(value));
export const dropDraft = (key: string) =>
  access("readwrite", (s) => s.delete(key));
