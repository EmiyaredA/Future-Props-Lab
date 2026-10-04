import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@platform/api/client";
import {
  useAccountId,
  useWorkspaceId,
} from "@platform/auth/WorkspacePermissions";
import {
  publishResourceRevision,
  subscribeResourceRevisions,
} from "@platform/sync/resourceBroadcast";
import { useDocumentAccess } from "../DocumentAccess";
import { thoughtKeys } from "../queryKeys";
import type { NavigationGuard } from "../NoteEditorPane";
import {
  tableOperations,
  tableStructure,
  type Operation,
  type Scope,
  type Structure,
  type RecordRow,
} from "./api";
import { drafts, dropDraft, putDraft, type TableDraft } from "./drafts";
import { serializeTableSave } from "./saveLane";

export function useTableDocument(
  note: string,
  scope: Scope,
  guard?: NavigationGuard,
) {
  const client = useQueryClient(),
    access = useDocumentAccess(),
    user = useAccountId(),
    workspace = useWorkspaceId();
  const context = scope.publication
    ? `${scope.publication}/${scope.parent ?? note}`
    : (workspace ?? "");
  const identity = `${user}/${context}/${note}`;
  const [tab] = useState(() => crypto.randomUUID());
  const key = `${identity}/${tab}`;
  const structure = useQuery({
    queryKey: thoughtKeys.multitable(context, note),
    queryFn: ({ signal }) => tableStructure(note, scope, signal),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const savedRevision = useRef<number | null>(null);
  const [pending, setPending] = useState<Operation[]>([]),
    queue = useRef<Operation[]>([]);
  const [state, setState] = useState("saved"),
    [error, setError] = useState("");
  const [conflict, setConflict] = useState<{
    structure: Structure;
    records: Record<string, RecordRow[]>;
  } | null>(null);
  const [recovery, setRecovery] = useState<TableDraft[]>([]),
    [ready, setReady] = useState(false);
  const blocked = useRef(false),
    flight = useRef<Promise<void> | null>(null),
    localWrites = useRef(Promise.resolve());
  const inFlightCount = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const dataRef = useRef(structure.data);
  dataRef.current = structure.data;
  useEffect(() => {
    let active = true;
    drafts(identity)
      .then((rows) => {
        if (active) setRecovery(rows);
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [identity]);
  const persist = useCallback(() => {
    const value: TableDraft = {
      key,
      document: identity,
      tab,
      revision: savedRevision.current ?? dataRef.current?.revision ?? 0,
      operations: structuredClone(queue.current),
      time: Date.now(),
    };
    localWrites.current = localWrites.current
      .catch(() => {})
      .then(async () => {
        if (value.operations.length) await putDraft(value);
        else await dropDraft(key);
      })
      .catch((e) => {
        setError(`本机草稿保存失败：${String(e)}`);
        throw e;
      });
    // Keep the rejection available to recovery without an unhandled promise.
    void localWrites.current.catch(() => {});
    return localWrites.current;
  }, [identity, key, tab]);
  const flush = useCallback(async (): Promise<void> => {
    if (flight.current) {
      await flight.current;
      if (queue.current.length) await flush();
      return;
    }
    if (blocked.current) throw new Error("保存已停止，请先处理冲突或恢复草稿");
    if (!queue.current.length) return;
    const sent = queue.current.length,
      operations = structuredClone(queue.current.slice(0, sent));
    inFlightCount.current = sent;
    const revision = savedRevision.current ?? dataRef.current?.revision;
    if (revision === undefined) throw new Error("表格尚未加载");
    setState("saving");
    flight.current = (async () => {
      try {
        const result = await serializeTableSave(`${user}/${note}`, () =>
          tableOperations(note, revision, operations, scopeRef.current),
        );
        savedRevision.current = result.structure.revision;
        client.setQueryData(
          thoughtKeys.multitable(context, note),
          result.structure,
        );
        queue.current = queue.current.slice(sent);
        await client.invalidateQueries({
          queryKey: thoughtKeys.multitableRecords(context, note),
        });
        setPending([...queue.current]);
        await persist();
        publishResourceRevision({
          kind: "thought-note",
          id: note,
          revision: result.structure.revision,
        });
        void client.invalidateQueries({ queryKey: thoughtKeys.note(note) });
        setState(queue.current.length ? "dirty" : "saved");
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const current = e.problem.current as
            | { structure?: Structure; records?: Record<string, RecordRow[]> }
            | undefined;
          if (current?.structure && current.records)
            setConflict({
              structure: current.structure,
              records: current.records,
            });
        }
        blocked.current = true;
        setState(
          e instanceof ApiError && e.status === 409 ? "conflict" : "error",
        );
        setError(e instanceof Error ? e.message : "保存失败，本机草稿已保留");
        throw e;
      } finally {
        inFlightCount.current = 0;
        flight.current = null;
      }
    })();
    await flight.current;
  }, [note, context, client, persist, user]);
  const enqueue = (operation: Operation) => {
    if (!ready || recovery.length || blocked.current) return;
    if (!queue.current.length && !flight.current)
      savedRevision.current = dataRef.current?.revision ?? null;
    const last = queue.current.at(-1);
    if (
      last?.op === "records.put" &&
      queue.current.length > inFlightCount.current &&
      operation.op === "records.put" &&
      last.table_id === operation.table_id
    ) {
      const rows = new Map(last.records.map((r) => [r.id, r]));
      for (const r of operation.records) rows.set(r.id, r);
      queue.current[queue.current.length - 1] = {
        ...last,
        records: [...rows.values()],
      };
    } else if (
      last?.op === "table.put" &&
      queue.current.length > inFlightCount.current &&
      operation.op === "table.put" &&
      last.table.id === operation.table.id
    )
      queue.current[queue.current.length - 1] = operation;
    else queue.current.push(operation);
    setPending([...queue.current]);
    setState("dirty");
    persist();
  };
  useEffect(() => {
    if (state !== "dirty") return;
    const timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [pending, state, flush]);
  useEffect(
    () =>
      subscribeResourceRevisions((message) => {
        if (message.kind !== "thought-note" || message.id !== note) return;
        void client.invalidateQueries({
          queryKey: thoughtKeys.multitable(context, note),
        });
        void client.invalidateQueries({
          queryKey: thoughtKeys.multitableRecords(context, note),
        });
      }),
    [client, context, note],
  );
  useEffect(() => {
    const stop = (event: BeforeUnloadEvent) => {
      if (queue.current.length) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, []);
  useEffect(() => {
    guard?.((proceed) => {
      if (!queue.current.length) return false;
      void flush()
        .then(proceed)
        .catch(() => {});
      return true;
    });
    return () => guard?.(null);
  }, [guard, flush, persist]);
  const resume = async () => {
    const latest = await structure.refetch();
    if (latest.isError || !latest.data)
      throw latest.error ?? new Error("无法读取最新表格，待保存操作仍已保留");
    savedRevision.current = latest.data.revision;
    blocked.current = false;
    setConflict(null);
    setError("");
    setState(queue.current.length ? "dirty" : "saved");
  };
  const recover = async (draft: TableDraft) => {
    setState("recovering");
    queue.current = draft.operations;
    savedRevision.current = draft.revision;
    setPending([...queue.current]);
    // Copy to this tab before removing the recoverable original.
    try {
      await persist();
    } catch (e) {
      setState("error");
      throw e;
    }
    if (draft.key !== key) await dropDraft(draft.key);
    setRecovery(recovery.filter((d) => d.key !== draft.key));
    blocked.current = false;
    setState("dirty");
  };
  const discard = async () => {
    queue.current = [];
    setPending([]);
    for (const d of recovery) await dropDraft(d.key);
    await dropDraft(key);
    setRecovery([]);
    setConflict(null);
    blocked.current = false;
    setError("");
    setState("saved");
    savedRevision.current = null;
    await structure.refetch();
  };
  return {
    structure,
    enqueue,
    flush,
    pending,
    state,
    error,
    conflict,
    setError,
    recovery,
    recover,
    discard,
    resume,
    ready,
    context,
    scope,
    access,
    disabled: !ready || !!recovery.length || blocked.current,
  };
}
export type TableController = ReturnType<typeof useTableDocument>;
