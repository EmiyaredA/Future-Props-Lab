import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@platform/api/client";
import { createProject, saveProject } from "./api";
import type { Draft, Project } from "./types";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
export function usePresentationDraft(
  initial: Project,
  onSaved: (project: Project) => void,
) {
  const [draft, setDraft] = useState<Draft>({
    title: initial.title,
    document: initial.document,
  });
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Project | null>(null);
  const [historyVersion, historyChanged] = useState(0);
  const latest = useRef(draft),
    saved = useRef(initial),
    generation = useRef(0),
    persisted = useRef(0);
  const flight = useRef<Promise<Project> | null>(null),
    blocked = useRef(false),
    alive = useRef(true);
  const composing = useRef(false),
    compositionEnd = useRef<(() => void) | null>(null);
  const composition = useRef<Promise<void> | null>(null);
  const history = useRef<{ before: Draft; after: Draft }[]>([]),
    future = useRef<{ before: Draft; after: Draft }[]>([]);
  const lastGroup = useRef({ key: "", time: 0 });
  const callback = useRef(onSaved);
  callback.current = onSaved;
  const change = useCallback((next: Draft) => {
    latest.current = next;
    generation.current += 1;
    setDraft(next);
    if (!blocked.current) setState("dirty");
  }, []);
  const commit = useCallback(
    (update: (current: Draft) => Draft, group = "") => {
      const before = latest.current,
        after = update(before);
      if (before === after || JSON.stringify(before) === JSON.stringify(after))
        return;
      const now = Date.now();
      if (
        group &&
        lastGroup.current.key === group &&
        (composing.current || now - lastGroup.current.time < 800) &&
        history.current.length
      ) {
        history.current[history.current.length - 1].after = after;
      } else {
        history.current.push({ before, after });
        if (history.current.length > 100) history.current.shift();
      }
      lastGroup.current = { key: group, time: now };
      future.current = [];
      change(after);
      historyChanged((v) => v + 1);
    },
    [change],
  );
  const undo = useCallback(() => {
    const entry = history.current.pop();
    if (!entry) return;
    future.current.push(entry);
    lastGroup.current.key = "";
    change(entry.before);
    historyChanged((v) => v + 1);
  }, [change]);
  const redo = useCallback(() => {
    const entry = future.current.pop();
    if (!entry) return;
    history.current.push(entry);
    lastGroup.current.key = "";
    change(entry.after);
    historyChanged((v) => v + 1);
  }, [change]);
  const flush = useCallback((): Promise<Project> => {
    if (flight.current) return flight.current;
    const drain = async () => {
      try {
        while (true) {
          if (composition.current) await composition.current;
          if (!alive.current) throw new Error("文稿已关闭");
          if (blocked.current) throw new Error("请先处理保存冲突");
          if (persisted.current === generation.current) return saved.current;
          const sent = generation.current,
            body = latest.current;
          setState("saving");
          setError("");
          const project = await saveProject(
            initial.id,
            body,
            saved.current.revision,
          );
          saved.current = project;
          persisted.current = sent;
          if (alive.current) {
            callback.current(project);
            setState(generation.current === sent ? "saved" : "dirty");
          }
        }
      } catch (reason) {
        if (alive.current) {
          if (reason instanceof ApiError && reason.status === 409) {
            blocked.current = true;
            setConflict(
              (reason.problem.current as Project | undefined) ?? null,
            );
            setState("conflict");
          } else if (!blocked.current) setState("error");
          setError(reason instanceof Error ? reason.message : "保存失败");
        }
        throw reason;
      }
    };
    const work = drain().finally(() => {
      flight.current = null;
    });
    flight.current = work;
    return work;
  }, [initial.id]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      compositionEnd.current?.();
    };
  }, []);
  useEffect(() => {
    if (state !== "dirty" || composing.current) return;
    const timer = window.setTimeout(() => {
      void flush().catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [draft, state, flush]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (generation.current !== persisted.current || composing.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const setComposition = useCallback((active: boolean) => {
    composing.current = active;
    if (active && !composition.current)
      composition.current = new Promise((resolve) => {
        compositionEnd.current = resolve;
      });
    if (!active) {
      compositionEnd.current?.();
      composition.current = null;
      setState(
        blocked.current
          ? "conflict"
          : generation.current === persisted.current
            ? "saved"
            : "dirty",
      );
    }
  }, []);
  const adopt = (project: Project) => {
    saved.current = project;
    blocked.current = false;
    persisted.current = ++generation.current;
    latest.current = { title: project.title, document: project.document };
    setDraft(latest.current);
    history.current = [];
    future.current = [];
    historyChanged((v) => v + 1);
    setConflict(null);
    setState("saved");
    setError("");
  };
  return {
    draft,
    state,
    error,
    conflict,
    commit,
    undo,
    redo,
    flush,
    adopt,
    setComposition,
    canUndo: historyVersion >= 0 && history.current.length > 0,
    canRedo: future.current.length > 0,
    isDirty: () =>
      generation.current !== persisted.current || composing.current,
    current: () => latest.current,
    duplicate: () =>
      createProject({
        ...latest.current,
        title: latest.current.title.slice(0, 110) + "（副本）",
      }),
  };
}
