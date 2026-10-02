import type { NoteInput } from "../api";

export type DraftIdentity = { userId: string; workspaceId: string };
export type LocalDraft = DraftIdentity & { key: string; noteId: string; tabId: string; revision: number; updatedAt: number; body: NoteInput };
const DB = "fpl-thought-drafts";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("当前环境无法保存本机草稿")); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("本机草稿存储不可用"));
    request.onblocked = () => reject(new Error("请关闭旧窗口后重试本机草稿存储"));
  });
}
async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const request = work(tx.objectStore("drafts"));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("本机草稿写入失败，请保留当前页面并重试保存")); };
  });
}
export const draftKey = (identity: DraftIdentity, noteId: string, tabId: string) => JSON.stringify([identity.userId, identity.workspaceId, noteId, tabId]);
export const putLocalDraft = (draft: LocalDraft) => transaction("readwrite", store => store.put(draft));
export async function removeLocalDraft(key: string, acknowledgedAt = Infinity) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite"), store = tx.objectStore("drafts");
    const request = store.get(key);
    request.onsuccess = () => { if (request.result && request.result.updatedAt <= acknowledgedAt) store.delete(key); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("本机草稿清理失败")); };
  });
}
export async function listLocalDrafts(identity: DraftIdentity, noteId: string) {
  const records = await transaction<LocalDraft[]>("readonly", store => store.getAll());
  return records.filter(row => row.userId === identity.userId && row.workspaceId === identity.workspaceId && row.noteId === noteId).sort((a,b) => b.updatedAt - a.updatedAt);
}
export function draftTabId() {
  const key = "fpl-thought-draft-tab";
  try { const id = sessionStorage.getItem(key) || crypto.randomUUID(); sessionStorage.setItem(key, id); return id; }
  catch { return crypto.randomUUID(); }
}
