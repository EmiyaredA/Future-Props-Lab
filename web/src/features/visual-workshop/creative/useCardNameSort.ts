import { useState } from "react";
import { useAccountId } from "@platform/auth/AccountAccess";
import type { CardKind } from "./api";

type Modes = Partial<Record<CardKind, boolean>>;
function read(key: string): Modes {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      ["character", "scene", "prop"].map((kind) => [
        kind,
        (value as Record<string, unknown>)[kind] === true,
      ]),
    );
  } catch {
    return {};
  }
}
export function useCardNameSort(scope: string) {
  const account = useAccountId();
  const key = `visual-card-sort:${JSON.stringify([account, scope])}`;
  const [record, setRecord] = useState(() => ({ key, modes: read(key) }));
  const modes = record.key === key ? record.modes : read(key);
  return {
    sorted: (kind: CardKind) => Boolean(modes[kind]),
    sort: (kind: CardKind) => {
      const next = { ...modes, [kind]: true };
      setRecord({ key, modes: next });
      try {
        if (account) localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Sorting still works when browser storage is unavailable. */
      }
    },
  };
}
