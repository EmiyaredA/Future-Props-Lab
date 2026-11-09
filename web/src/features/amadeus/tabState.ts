import type { Reference } from "./protocol";

export function amadeusTabKey(account: string, scope: string) {
  return `amadeus-tab:v1:${account}:${import.meta.env.VITE_FPL_SERVICE || "studio"}:${scope}`;
}

export function readTabState<T>(key: string): T | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null") ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeTabState(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The assistant stays usable when browser storage is unavailable.
  }
}

export type DraftState = { text: string; references: Reference[] };

export function readDraft(key: string): DraftState {
  const saved = readTabState<DraftState>(key);
  return {
    text: typeof saved?.text === "string" ? saved.text : "",
    references: Array.isArray(saved?.references) ? saved.references : [],
  };
}
