import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@platform/api/client";
import {
  createNote,
  noteInput,
  saveNote,
  type Note,
  type NoteInput,
} from "./api";

export type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
export function useNoteDraft(initial: Note, onSaved: (note: Note) => void) {
  const [draft, setDraft] = useState<NoteInput>(() => noteInput(initial));
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Note | null>(null);
  const [composing, setComposing] = useState(false);
  const composition = useRef<Promise<void> | null>(null);
  const endComposition = useRef<(() => void) | null>(null);
  const [savedAt, setSavedAt] = useState(initial.updated_at);
  const draftRef = useRef(draft);
  const saved = useRef(initial);
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
    if (!blocked.current) setState("dirty");
  }, []);

  const flush = useCallback(async (): Promise<Note> => {
    if (composition.current) await composition.current;
    if (!alive.current) throw new Error("文档已关闭");
    if (flight.current) {
      await flight.current;
      if (generation.current !== savedGeneration.current) return flush();
      return saved.current;
    }
    if (blocked.current) throw new Error("请先处理保存冲突");
    if (generation.current === savedGeneration.current) return saved.current;
    const sent = generation.current;
    const body = structuredClone(draftRef.current);
    setState("saving");
    setError("");
    const promise = saveNote(initial.id, body, saved.current.revision);
    flight.current = promise;
    try {
      const next = await promise;
      saved.current = next;
      savedGeneration.current = sent;
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
        } else setState("error");
        setError(caught instanceof Error ? caught.message : "保存失败");
      }
      throw caught;
    } finally {
      flight.current = null;
    }
  }, [initial.id]);

  useEffect(() => {
    if (state !== "dirty" || composing) return;
    const timer = window.setTimeout(() => {
      void flush().catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [draft, state, flush, composing]);
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
    saved.current = server;
    draftRef.current = noteInput(server);
    savedGeneration.current = ++generation.current;
    blocked.current = false;
    setConflict(null);
    setError("");
    setDraft(draftRef.current);
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
    createNote({
      ...draftRef.current,
      title: `${draftRef.current.title.slice(0, 230)}（本地副本）`,
    });
  return {
    draft,
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
