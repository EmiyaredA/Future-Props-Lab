import { approvalTarget } from "./approval";
import {
  amadeusTabKey,
  readDraft,
  readTabState,
  writeTabState,
} from "./tabState";
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { fetchApiJson } from "@platform/api/client";
import { mergeReferences } from "./elementReferences";
import type { AmadeusPageBridge } from "./PageContext";
import type { AccountSessionContext } from "@features/accounts";
import type {
  AvatarState,
  Context,
  Conversation,
  Detail,
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
  initialConversationId?: string;
  bridge: AmadeusPageBridge;
  detail: Detail | null;
  standalone: boolean;
  draft: string;
  references: Reference[];
  setDraft: Dispatch<SetStateAction<string>>;
  detailRef: RefObject<Detail | null>;
  contextRef: RefObject<Context[]>;
  avatarTimerRef: RefObject<number | undefined>;
  activeActionRef: RefObject<{
    conversationId: string;
    actionId: string;
  } | null>;
  loaded: string[];
  loadedConversationId: string | null;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setDetail: Dispatch<SetStateAction<Detail | null>>;
  setRuns: Dispatch<SetStateAction<RunDetail[]>>;
  setActiveRun: Dispatch<SetStateAction<Run | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setReferences: Dispatch<SetStateAction<Reference[]>>;
  setFilesOpen: Dispatch<SetStateAction<boolean>>;
  setWorkFiles: Dispatch<SetStateAction<import("./protocol").WorkFile[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setContexts: Dispatch<SetStateAction<Context[]>>;
  setAvatarState: Dispatch<SetStateAction<AvatarState>>;
  setLoaded: Dispatch<SetStateAction<string[]>>;
  setLoadedConversationId: Dispatch<SetStateAction<string | null>>;
};

/** Owns scoped reads and the session-bound subscriptions for the assistant window. */
export function useAmadeusData(options: Options) {
  const {
    session,
    initialConversationId,
    bridge,
    detail,
    standalone,
    draft,
    references,
    setDraft,
    detailRef,
    contextRef,
    avatarTimerRef,
    activeActionRef,
    loaded,
    loadedConversationId,
    setConversations,
    setDetail,
    setRuns,
    setActiveRun,
    setBusy,
    setReferences,
    setFilesOpen,
    setWorkFiles,
    setError,
    setContexts,
    setAvatarState,
    setLoaded,
    setLoadedConversationId,
  } = options;
  const owner = session.me.user.id;
  const tabKey = amadeusTabKey(owner, standalone ? "standalone" : "embedded");
  const hydrated = useRef(false);
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
        const saved = readDraft(`${tabKey}:draft:${id}`);
        setDraft(saved.text);
        setReferences(saved.references);
        reads.selection++;
        setFilesOpen(false);
        setWorkFiles([]);
      }
      reads.selectedId = id;
      const controller = new AbortController();
      reads.detail = controller;
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
      return history;
    },
    [
      detailRef,
      setDetail,
      setRuns,
      setReferences,
      setDraft,
      tabKey,
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
    const saved = readDraft(`${tabKey}:draft:new`);
    setReferences(saved.references);
    setDraft(saved.text);
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
        if (
          initialConversationId &&
          !items.some((item) => item.id === initialConversationId)
        ) {
          setError("此对话不存在或已无法访问。");
          return;
        }
        const saved = readTabState<{ id: string | null }>(tabKey);
        if (!initialConversationId && saved?.id === null) return;
        const selectedId = initialConversationId || saved?.id;
        const selected =
          items.find((item) => item.id === selectedId) || items[0];
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
        if (
          !initialConversationId &&
          !readTabState<{ id: string | null }>(tabKey) &&
          readsRef.current === reads &&
          reads.selection === selection
        )
          await open(running.run.conversation_id);
      })
      .catch((cause) => {
        if (alive && (cause as Error)?.name !== "AbortError")
          setError(String(cause));
      });
    void bridge.amadeusContexts().then((value) => {
      if (alive) setContexts(value as Context[]);
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
        origin.accountId === session.me.user.id
      )
        setReferences((previous) => mergeReferences(previous, [reference]));
    });
    const offPickFinished = bridge.onAmadeusPickFinished?.(() => {
      if (!alive) return;
      setAvatarState((current) => (current === "listening" ? "idle" : current));
    });
    return () => {
      alive = false;
      reads.selection++;
      reads.list?.abort();
      reads.detail?.abort();
      offContexts();
      offReference();
      offPickFinished?.();
      clearAvatarTimer(avatarTimerRef);
    };
  }, [
    session.me.user.id,
    initialConversationId,

    bridge,
    open,
    refreshList,
    owner,
    tabKey,
    setDraft,
    detailRef,
    contextRef,
    avatarTimerRef,
    setConversations,
    setDetail,
    setRuns,
    setActiveRun,
    setBusy,
    setReferences,
    setFilesOpen,
    setWorkFiles,
    setError,
    setContexts,
    setAvatarState,
  ]);

  const conversationId = detail?.conversation.id;
  const settlingActionId = detail?.actions.find(
    (action) => action.status === "running",
  )?.id;
  useEffect(() => {
    if (!conversationId || !settlingActionId) return;
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      const onScreen = () =>
        !controller.signal.aborted &&
        readsRef.current.selectedId === conversationId;
      if (!onScreen()) return;
      if (activeActionRef.current?.actionId !== settlingActionId) {
        try {
          const snapshot = await fetchApiJson<Detail>(
            `/v1/amadeus/conversations/${conversationId}`,
            { signal: controller.signal },
          );
          if (!onScreen()) return;
          const action = snapshot.actions.find(
            (item) => item.id === settlingActionId,
          );
          detailRef.current = snapshot;
          setDetail(snapshot);
          if (action?.status === "completed") {
            const target = approvalTarget(action);
            if (target) void bridge.publishAmadeusMutation(target);
          }
          if (action?.status !== "running") return;
        } catch {
          if (!onScreen()) return;
        }
      }
      timer = window.setTimeout(() => void poll(), 1200);
    };
    timer = window.setTimeout(() => void poll(), 1200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    activeActionRef,
    bridge,
    conversationId,
    detailRef,
    settlingActionId,
    setDetail,
  ]);

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    if (readsRef.current.selectedId !== conversationId) return;
    if (conversationId) writeTabState(tabKey, { id: conversationId });
    else if (!readTabState<{ id: string | null }>(tabKey) && draft.trim())
      writeTabState(tabKey, { id: null });
    writeTabState(`${tabKey}:draft:${conversationId ?? "new"}`, {
      text: draft,
      references,
    });
  }, [conversationId, draft, references, tabKey]);

  const captureSelection = () => {
    const reads = readsRef.current;
    const selection = reads.selection;
    return () => reads === readsRef.current && reads.selection === selection;
  };
  const clearSelection = () => {
    const reads = readsRef.current;
    reads.detail?.abort();
    reads.selectedId = undefined;
    reads.selection++;
    detailRef.current = null;
    setDetail(null);
    setDraft("");
    setReferences([]);
    setRuns([]);
    setFilesOpen(false);
    setWorkFiles([]);
    writeTabState(tabKey, { id: null });
  };
  const selectionPending = () =>
    Boolean(readsRef.current.selectedId && !detailRef.current);
  const adopt = (next: Detail) => {
    readsRef.current.selection++;
    readsRef.current.selectedId = next.conversation.id;
    detailRef.current = next;
    setDetail(next);
    writeTabState(`${tabKey}:draft:new`, { text: "", references: [] });
  };

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

  return {
    refreshList,
    open,
    captureSelection,
    adopt,
    selectionPending,
    clearSelection,
  };
}
