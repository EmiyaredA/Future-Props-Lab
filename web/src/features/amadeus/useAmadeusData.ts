import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { fetchApiJson } from "@platform/api/client";
import type { DesktopBridge } from "@platform/desktop";
import type { AccountSessionContext } from "@features/accounts";
import type {
  AvatarState,
  Context,
  Conversation,
  Detail,
  ModelOption,
  Reference,
  Run,
  RunDetail,
} from "./protocol";

type Reads = {
  owner: string;
  list?: AbortController;
  detail?: AbortController;
  selectedId?: string;
  selection: number;
};

function clearAvatarTimer(ref: RefObject<number | undefined>) {
  if (ref.current) window.clearTimeout(ref.current);
}

type Options = {
  session: AccountSessionContext;
  bridge: Required<DesktopBridge>;
  detail: Detail | null;
  detailRef: RefObject<Detail | null>;
  contextRef: RefObject<Context[]>;
  avatarTimerRef: RefObject<number | undefined>;
  loaded: string[];
  loadedConversationId: string | null;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setDetail: Dispatch<SetStateAction<Detail | null>>;
  setRuns: Dispatch<SetStateAction<RunDetail[]>>;
  setActiveRun: Dispatch<SetStateAction<Run | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setReferences: Dispatch<SetStateAction<Reference[]>>;
  setAttachments: Dispatch<
    SetStateAction<Array<{ name: string; bytes: number }>>
  >;
  setFilesOpen: Dispatch<SetStateAction<boolean>>;
  setWorkFiles: Dispatch<SetStateAction<import("./protocol").WorkFile[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setModels: Dispatch<SetStateAction<ModelOption[]>>;
  setModelId: Dispatch<SetStateAction<string>>;
  setContexts: Dispatch<SetStateAction<Context[]>>;
  setAlwaysOnTop: Dispatch<SetStateAction<boolean>>;
  setAvatarState: Dispatch<SetStateAction<AvatarState>>;
  setLoaded: Dispatch<SetStateAction<string[]>>;
  setLoadedConversationId: Dispatch<SetStateAction<string | null>>;
};

/** Owns scoped reads and the session-bound subscriptions for the assistant window. */
export function useAmadeusData(options: Options) {
  const {
    session,
    bridge,
    detail,
    detailRef,
    contextRef,
    avatarTimerRef,
    loaded,
    loadedConversationId,
    setConversations,
    setDetail,
    setRuns,
    setActiveRun,
    setBusy,
    setReferences,
    setAttachments,
    setFilesOpen,
    setWorkFiles,
    setError,
    setModels,
    setModelId,
    setContexts,
    setAlwaysOnTop,
    setAvatarState,
    setLoaded,
    setLoadedConversationId,
  } = options;
  const owner = `${session.me.user.id}:${session.me.workspace.id}`;
  const readsRef = useRef<Reads>({ owner, selection: 0 });
  if (readsRef.current.owner !== owner) {
    readsRef.current.list?.abort();
    readsRef.current.detail?.abort();
    readsRef.current = { owner, selection: readsRef.current.selection + 1 };
  }
  const refreshList = useCallback(async () => {
    const reads = readsRef.current;
    reads.list?.abort();
    const controller = new AbortController();
    reads.list = controller;
    let result: { items: Conversation[] };
    try {
      result = await fetchApiJson<{ items: Conversation[] }>(
        "/v1/amadeus/conversations",
        { signal: controller.signal },
      );
    } catch (cause) {
      if (controller.signal.aborted) return [];
      throw cause;
    }
    if (controller.signal.aborted || readsRef.current !== reads) return [];
    setConversations(result.items);
    return result.items;
  }, [setConversations]);
  const open = useCallback(
    async (id: string) => {
      const reads = readsRef.current;
      reads.detail?.abort();
      if (reads.selectedId !== id) {
        setDetail(null);
        detailRef.current = null;
        setRuns([]);
        setReferences([]);
        setAttachments([]);
        setFilesOpen(false);
        setWorkFiles([]);
      }
      reads.selectedId = id;
      const controller = new AbortController();
      reads.detail = controller;
      reads.selection++;
      let next: Detail;
      let history: RunDetail[];
      try {
        [next, history] = await Promise.all([
          fetchApiJson<Detail>(`/v1/amadeus/conversations/${id}`, {
            signal: controller.signal,
          }),
          fetchApiJson<RunDetail[]>(`/v1/amadeus/conversations/${id}/runs`, {
            signal: controller.signal,
          }),
        ]);
      } catch (cause) {
        if (controller.signal.aborted) return;
        throw cause;
      }
      if (controller.signal.aborted || readsRef.current !== reads) return;
      setDetail(next);
      setRuns(history);
      detailRef.current = next;
      setReferences([]);
      setAttachments([]);
      setFilesOpen(false);
      setWorkFiles([]);
    },
    [
      detailRef,
      setDetail,
      setRuns,
      setReferences,
      setAttachments,
      setFilesOpen,
      setWorkFiles,
    ],
  );

  useEffect(() => {
    let alive = true;
    const reads = readsRef.current;
    const selection = reads.selection;
    setConversations([]);
    setDetail(null);
    detailRef.current = null;
    setRuns([]);
    setActiveRun(null);
    setBusy(false);
    setReferences([]);
    setAttachments([]);
    setFilesOpen(false);
    setWorkFiles([]);
    void refreshList()
      .then((items) => {
        if (
          !alive ||
          readsRef.current !== reads ||
          reads.selection !== selection
        )
          return;
        const saved = localStorage.getItem(`amadeus-current:${owner}`);
        const selected = items.find((item) => item.id === saved) || items[0];
        if (selected)
          void open(selected.id).catch((cause) => {
            if (alive && (cause as Error)?.name !== "AbortError")
              setError(String(cause));
          });
      })
      .catch((cause) => {
        if (alive && (cause as Error)?.name !== "AbortError")
          setError(String(cause));
      });
    void fetchApiJson<RunDetail | null>("/v1/amadeus/runs/active")
      .then(async (running) => {
        if (!alive || !running) return;
        setActiveRun(running.run);
        setBusy(true);
        if (readsRef.current === reads && reads.selection === selection)
          await open(running.run.conversation_id);
      })
      .catch((cause) => {
        if (alive && (cause as Error)?.name !== "AbortError")
          setError(String(cause));
      });
    void bridge.amadeusContexts().then((value) => {
      if (alive) setContexts(value as Context[]);
    });
    void bridge.amadeusAlwaysOnTop().then((value) => {
      if (alive && typeof value === "boolean") setAlwaysOnTop(value);
    });
    const offContexts = bridge.onAmadeusContexts((value) => {
      if (alive) setContexts(value as Context[]);
    });
    const offReference = bridge.onAmadeusReference((value) => {
      if (!alive) return;
      const reference = value as Reference;
      const origin = contextRef.current.find(
        (item) => item.windowId === reference.windowId,
      );
      if (
        origin?.userId === session.me.user.id &&
        origin.workspaceId === session.me.workspace.id
      )
        setReferences((previous) => [...previous, reference].slice(0, 20));
    });
    const offPickFinished = bridge.onAmadeusPickFinished?.(() => {
      if (!alive) return;
      setAvatarState((current) => (current === "listening" ? "idle" : current));
    });
    return () => {
      alive = false;
      reads.list?.abort();
      reads.detail?.abort();
      offContexts();
      offReference();
      offPickFinished?.();
      clearAvatarTimer(avatarTimerRef);
    };
  }, [
    session.me.user.id,
    session.me.workspace.id,
    bridge,
    open,
    refreshList,
    owner,
    detailRef,
    contextRef,
    avatarTimerRef,
    setConversations,
    setDetail,
    setRuns,
    setActiveRun,
    setBusy,
    setReferences,
    setAttachments,
    setFilesOpen,
    setWorkFiles,
    setError,
    setModels,
    setModelId,
    setContexts,
    setAlwaysOnTop,
    setAvatarState,
  ]);

  const conversationId = detail?.conversation.id;
  useEffect(() => {
    if (!conversationId) return;
    localStorage.setItem(
      `amadeus-current:${session.me.user.id}:${session.me.workspace.id}`,
      conversationId,
    );
  }, [conversationId, session.me.user.id, session.me.workspace.id]);

  useEffect(() => {
    if (!conversationId) {
      setLoaded([]);
      setLoadedConversationId(null);
      return;
    }
    try {
      setLoaded(
        JSON.parse(
          localStorage.getItem(`amadeus-loaded:${conversationId}`) || "[]",
        ),
      );
    } catch {
      setLoaded([]);
    }
    setLoadedConversationId(conversationId);
  }, [conversationId, setLoaded, setLoadedConversationId]);

  useEffect(() => {
    if (!conversationId || loadedConversationId !== conversationId) return;
    localStorage.setItem(
      `amadeus-loaded:${conversationId}`,
      JSON.stringify(loaded),
    );
  }, [loaded, conversationId, loadedConversationId]);

  return { refreshList, open };
}
