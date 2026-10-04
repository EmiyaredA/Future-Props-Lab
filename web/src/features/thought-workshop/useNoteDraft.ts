import { useDocumentAccess } from "./DocumentAccess";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAccountId,
  useWorkspaceId,
} from "@platform/auth/WorkspacePermissions";
import {
  draftKey,
  draftTabId,
  listLocalDrafts,
  putLocalDraft,
  removeLocalDraft,
  type LocalDraft,
} from "./drafts/storage";
import { ApiError } from "@platform/api/client";
import { publishResourceRevision } from "@platform/sync/resourceBroadcast";
import { noteInput, type Note, type NoteInput } from "./api";

export type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
export function useNoteDraft(initial: Note, onSaved: (note: Note) => void) {
  const access = useDocumentAccess();
  const activeWorkspace = useWorkspaceId();
  const userId = useAccountId(),
    workspaceId = access.community ? access.namespace : activeWorkspace;
  const [tabId] = useState(draftTabId);
  const identity = userId && workspaceId ? { userId, workspaceId } : null;
  const key = identity ? draftKey(identity, initial.id, tabId) : null;
  const [recovery, setRecovery] = useState<LocalDraft[]>([]);
  const recoveryRef = useRef<LocalDraft[]>([]);
  const [localError, setLocalError] = useState("");
  const [localReady, setLocalReady] = useState(!identity);
  const ready = useRef<Promise<void>>(Promise.resolve());
  const localTime = useRef(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const [draft, setDraft] = useState<NoteInput>(() => noteInput(initial));
  const [titleInput, setTitleInputState] = useState<string | null>(null);
  const titleInputRef = useRef<string | null>(null);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Note | null>(null);
  const [composing, setComposing] = useState(false);
  const composition = useRef<Promise<void> | null>(null);
  const endComposition = useRef<(() => void) | null>(null);
  const [savedAt, setSavedAt] = useState(initial.updated_at);
  const draftRef = useRef(draft);
  const saved = useRef(initial);
  const opened = useRef(initial);
  const generation = useRef(0);
  const savedGeneration = useRef(0);
  const blocked = useRef(false);
  const flight = useRef<Promise<Note> | null>(null);
  const alive = useRef(true);
  const callback = useRef(onSaved);
  callback.current = onSaved;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const localFailure = (error: unknown) => {
    if (alive.current)
      setLocalError(
        error instanceof Error ? error.message : "本机草稿存储失败",
      );
  };
  const persist = useRef<() => void>(() => {});
  persist.current = () => {
    if (!identity || !key) return;
    localTime.current = Math.max(Date.now(), localTime.current + 1);
    const record: LocalDraft = {
      ...identity,
      key,
      noteId: initial.id,
      tabId,
      revision: saved.current.revision,
      updatedAt: localTime.current,
      body: structuredClone(draftRef.current),
      ...(titleInputRef.current !== null &&
      titleInputRef.current !== draftRef.current.title
        ? { titleInput: titleInputRef.current }
        : {}),
    };
    writes.current = writes.current
      .catch(() => {})
      .then(() => putLocalDraft(record))
      .catch(localFailure);
  };
  useEffect(() => {
    if (!userId || !workspaceId) return;
    let active = true;
    ready.current = listLocalDrafts({ userId, workspaceId }, initial.id)
      .then(async (records) => {
        const pending: LocalDraft[] = [];
        for (const row of records) {
          if (
            row.titleInput === undefined &&
            JSON.stringify(row.body) ===
              JSON.stringify(noteInput(opened.current))
          )
            await removeLocalDraft(row.key, row.updatedAt);
          else pending.push(row);
        }
        if (active) {
          recoveryRef.current = pending;
          setRecovery(pending);
        }
      })
      .catch(localFailure)
      .finally(() => {
        if (active) setLocalReady(true);
      });
    return () => {
      active = false;
    };
  }, [userId, workspaceId, initial.id]);

  const change = useCallback((patch: Partial<NoteInput>) => {
    if (
      Object.entries(patch).every(
        ([key, value]) =>
          JSON.stringify(draftRef.current[key as keyof NoteInput]) ===
          JSON.stringify(value),
      )
    )
      return;
    draftRef.current = { ...draftRef.current, ...patch };
    generation.current += 1;
    setDraft(draftRef.current);
    persist.current();
    if (!blocked.current) setState("dirty");
  }, []);

  const flush = useCallback(async (): Promise<Note> => {
    if (key) await ready.current;
    if (recoveryRef.current.length) throw new Error("请先恢复或丢弃本机草稿");
    if (composition.current) await composition.current;
    if (!alive.current) throw new Error("文档已关闭");
    if (flight.current) {
      await flight.current;
      if (generation.current !== savedGeneration.current) return flush();
      return saved.current;
    }
    if (blocked.current)
      throw new Error(
        "保存已停止，请先处理保存冲突或确认文章访问权限；本机草稿已保留。",
      );
    if (generation.current === savedGeneration.current) return saved.current;
    const sent = generation.current;
    const acknowledgedAt = localTime.current;
    const body = structuredClone(draftRef.current);
    setState("saving");
    setError("");
    const promise = access.save(initial.id, body, saved.current.revision);
    flight.current = promise;
    try {
      const next = await promise;
      saved.current = next;
      savedGeneration.current = sent;
      if (key) {
        writes.current = writes.current
          .catch(() => {})
          .then(() => removeLocalDraft(key, acknowledgedAt))
          .catch(localFailure);
        if (generation.current !== sent) persist.current();
      }
      publishResourceRevision({
        kind: "thought-note",
        id: initial.id,
        revision: next.revision,
      });
      if (alive.current) {
        callback.current(next);
        setSavedAt(next.updated_at);
        setState(sent === generation.current ? "saved" : "dirty");
      }
      return next;
    } catch (caught) {
      if (alive.current) {
        if (caught instanceof ApiError && caught.status === 409) {
          blocked.current = true;
          setConflict((caught.problem.current as Note | undefined) ?? null);
          setState("conflict");
        } else {
          if (
            access.community &&
            caught instanceof ApiError &&
            [403, 404].includes(caught.status)
          )
            blocked.current = true;
          setState("error");
        }
        setError(caught instanceof Error ? caught.message : "保存失败");
      }
      throw caught;
    } finally {
      flight.current = null;
    }
  }, [initial.id, key, access]);

  useEffect(() => {
    if (state !== "dirty" || composing || recovery.length) return;
    const timer = window.setTimeout(() => {
      void flush().catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [draft, state, flush, composing, recovery.length]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (
        generation.current !== savedGeneration.current ||
        composition.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  const adopt = (server: Note) => {
    if (key)
      writes.current = writes.current
        .catch(() => {})
        .then(() => removeLocalDraft(key))
        .catch(localFailure);
    saved.current = server;
    draftRef.current = noteInput(server);
    savedGeneration.current = ++generation.current;
    blocked.current = false;
    setConflict(null);
    setError("");
    setDraft(draftRef.current);
    titleInputRef.current = null;
    setTitleInputState(null);
    setState("saved");
    setSavedAt(server.updated_at);
  };
  const setComposition = useCallback((active: boolean) => {
    if (active && !composition.current) {
      composition.current = new Promise<void>((resolve) => {
        endComposition.current = resolve;
      });
    } else if (!active) {
      endComposition.current?.();
      composition.current = null;
      endComposition.current = null;
    }
    setComposing(active);
  }, []);
  const duplicate = () =>
    (
      access.duplicate ??
      (() =>
        Promise.reject(
          new Error("社区草稿不能另存到源 Workspace；请保留草稿或复制文本。"),
        ))
    )({
      ...draftRef.current,
      title: `${draftRef.current.title.slice(0, 230)}（本地副本）`,
    });
  const discardLocal = async (row: LocalDraft) => {
    try {
      await removeLocalDraft(row.key, row.updatedAt);
      recoveryRef.current = recoveryRef.current.filter(
        (item) => item.key !== row.key,
      );
      setRecovery(recoveryRef.current);
    } catch (error) {
      localFailure(error);
    }
  };
  const restoreLocal = async (row: LocalDraft) => {
    const different = row.revision !== saved.current.revision;
    change(row.body);
    titleInputRef.current = row.titleInput ?? null;
    setTitleInputState(titleInputRef.current);
    if (different) {
      blocked.current = true;
      setConflict(saved.current);
      setState("conflict");
      setError("草稿基准版本已变化，可查看服务器版本或另存副本。");
    }
    await discardLocal(row);
    persist.current();
  };
  return {
    recovery,
    localReady,
    localError,
    discardLocal,
    restoreLocal,
    duplicateLocal: async (row: LocalDraft) => {
      const next = await (
        access.duplicate ??
        (() => Promise.reject(new Error("社区草稿不能另存到源 Workspace")))
      )({
        ...row.body,
        title: row.body.title.slice(0, 230) + "（恢复副本）",
      });
      await discardLocal(row);
      return next;
    },
    draft,
    titleInput,
    setTitleInput: (value: string | null) => {
      titleInputRef.current = value;
      setTitleInputState(value);
      persist.current();
    },
    change,
    flush,
    state,
    error,
    conflict,
    adopt,
    duplicate,
    savedAt,
    setComposition,
    markConflict: (server: Note) => {
      blocked.current = true;
      setConflict(server);
      setState("conflict");
      setError("文档已在其他地方更新，请先处理保存冲突。");
    },
    isDirty: () =>
      generation.current !== savedGeneration.current || !!composition.current,
  };
}
