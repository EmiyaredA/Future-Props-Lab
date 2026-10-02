import type { NoteInput } from "../api";

export type DraftIdentity = { userId: string; workspaceId: string };
export type LocalDraft = DraftIdentity & {
  key: string;
  noteId: string;
  tabId: string;
  revision: number;
  updatedAt: number;
  body: NoteInput;
  titleInput?: string;
};
const DB = "fpl-thought-drafts";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("当前环境无法保存本机草稿"));
      return;
    }
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains("drafts")
        ? request.transaction!.objectStore("drafts")
        : request.result.createObjectStore("drafts", { keyPath: "key" });
      if (!store.indexNames.contains("by-document"))
        store.createIndex("by-document", ["userId", "workspaceId", "noteId"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("本机草稿存储不可用"));
    request.onblocked = () =>
      reject(new Error("请关闭旧窗口后重试本机草稿存储"));
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const request = work(tx.objectStore("drafts"));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error("本机草稿写入失败，请保留当前页面并重试保存"));
    };
  });
}
export const draftKey = (
  identity: DraftIdentity,
  noteId: string,
  tabId: string,
) => JSON.stringify([identity.userId, identity.workspaceId, noteId, tabId]);
export const putLocalDraft = (draft: LocalDraft) =>
  transaction("readwrite", (store) => store.put(draft));
export async function removeLocalDraft(key: string, acknowledgedAt = Infinity) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite"),
      store = tx.objectStore("drafts");
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result && request.result.updatedAt <= acknowledgedAt)
        store.delete(key);
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error("本机草稿清理失败"));
    };
  });
}
export async function listLocalDrafts(identity: DraftIdentity, noteId: string) {
  const records = await transaction<LocalDraft[]>("readonly", (store) =>
    store
      .index("by-document")
      .getAll(
        IDBKeyRange.only([identity.userId, identity.workspaceId, noteId]),
      ),
  );
  return records
    .filter(
      (row) =>
        row.userId === identity.userId &&
        row.workspaceId === identity.workspaceId &&
        row.noteId === noteId,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
// A duplicated browser tab inherits sessionStorage. A document-lifetime ID keeps
// those tabs independent; recovery discovers previous document lifetimes by owner.
let tabId: string | undefined;
export function draftTabId() {
  return (tabId ??= crypto.randomUUID());
}
