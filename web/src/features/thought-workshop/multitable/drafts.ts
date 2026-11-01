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
    const r = indexedDB.open("fpl-multitable-drafts", 2);
    r.onupgradeneeded = () => {
      const s = r.result.objectStoreNames.contains("drafts")
        ? r.transaction!.objectStore("drafts")
        : r.result.createObjectStore("drafts", { keyPath: "key" });
      if (!s.indexNames.contains("document"))
        s.createIndex("document", "document");
      const request = s.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const row = cursor.value as TableDraft;
        const parts = row.document.split("/");
        if (parts.length === 3 && parts[0] !== parts[1]) {
          const document = `${parts[0]}/${parts[0]}/${parts[2]}`;
          s.put({
            ...row,
            document,
            key: `${document}/${row.tab}/legacy/${encodeURIComponent(row.key)}`,
          });
          cursor.delete();
        }
        cursor.continue();
      };
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
