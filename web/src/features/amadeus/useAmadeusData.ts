import { approvalTarget } from "./approval";
import {
  amadeusTabKey,
  readDraft,
  readTabState,
  writeTabState,
} from "./tabState";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApiJson } from "@platform/api/client";
import { mergeReferences } from "./elementReferences";
import type { AmadeusPageBridge } from "./PageContext";
import type {
  Context,
  Conversation,
  Detail,
  Reference,
  RunDetail,
} from "./protocol";

type Reads = {
  owner: string;
  list?: AbortController;
  detail?: AbortController;
  selectedId?: string;
  selection: number;
  selectionReads: AbortController;
};

function advanceSelection(reads: Reads) {
  reads.selectionReads.abort();
  reads.selectionReads = new AbortController();
  reads.selection++;
}

type Options = {
  owner: string;
  initialConversationId?: string;
  bridge: AmadeusPageBridge;
  standalone: boolean;
  isExecutingAction: (id: string) => boolean;
  onPickFinished: () => void;
  onError: (message: string) => void;
};

/** Owns conversation snapshots, scoped reads, and drafts for the assistant window. */
export function useAmadeusData({
  owner,
  initialConversationId,
  bridge,
  standalone,
  isExecutingAction,
  onPickFinished,
  onError: setError,
}: Options) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [runs, setRuns] = useState<RunDetail[]>([]);
  const [draft, setDraft] = useState("");
  const [references, setReferences] = useState<Reference[]>([]);
  const [contexts, setContexts] = useState<Context[]>([]);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [loadedConversationId, setLoadedConversationId] = useState<
    string | null
  >(null);
  const detailRef = useRef<Detail | null>(null);
  const contextRef = useRef<Context[]>([]);
  const mounted = useRef(false);
  const getDetail = useCallback(() => detailRef.current, []);
  const replaceDetail = useCallback((value: Detail | null) => {
    detailRef.current = value;
    setDetail(value);
  }, []);
  const tabKey = amadeusTabKey(owner, standalone ? "standalone" : "embedded");
  const hydratedTab = useRef<string | undefined>(undefined);
  const readsRef = useRef<Reads>({
    owner,
    selection: 0,
    selectionReads: new AbortController(),
  });
  if (readsRef.current.owner !== owner) {
    readsRef.current.list?.abort();
    readsRef.current.detail?.abort();
    readsRef.current.selectionReads.abort();
    readsRef.current = {
      owner,
      selection: 0,
      selectionReads: new AbortController(),
    };
  }
  const refreshList = useCallback(async () => {
    const reads = readsRef.current;
    if (!mounted.current || reads.owner !== owner) return [];
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
  }, [owner]);
  const open = useCallback(
    async (id: string) => {
      const reads = readsRef.current;
      if (!mounted.current || reads.owner !== owner) return;
      reads.detail?.abort();
      if (reads.selectedId !== id) {
        replaceDetail(null);
        setRuns([]);
        const saved = readDraft(`${tabKey}:draft:${id}`);
        setDraft(saved.text);
        setReferences(saved.references);
        advanceSelection(reads);
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
      replaceDetail(next);
      setRuns(history);
      return history;
    },
    [owner, replaceDetail, tabKey],
  );

  useEffect(() => {
    let alive = true;
    const reads = readsRef.current;
    const selection = reads.selection;
    mounted.current = true;
    setConversations([]);
    replaceDetail(null);
    setRuns([]);
    contextRef.current = [];
    setContexts([]);
    const saved = readDraft(`${tabKey}:draft:new`);
    setReferences(saved.references);
    setDraft(saved.text);
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
    let contextVersion = 0;
    const acceptContexts = (value: unknown) => {
      if (!alive) return;
      contextRef.current = value as Context[];
      setContexts(contextRef.current);
    };
    void bridge.amadeusContexts().then((value) => {
      if (contextVersion === 0) acceptContexts(value);
    });
    const offContexts = bridge.onAmadeusContexts((value) => {
      contextVersion++;
      acceptContexts(value);
    });
    const offReference = bridge.onAmadeusReference((value) => {
      if (!alive) return;
      const reference = value as Reference;
      const origin = contextRef.current.find(
        (item) => item.windowId === reference.windowId,
      );
      if (origin?.userId === owner && origin.accountId === owner)
        setReferences((previous) => mergeReferences(previous, [reference]));
    });
    const offPickFinished = bridge.onAmadeusPickFinished?.(onPickFinished);
    return () => {
      alive = false;
      mounted.current = false;
      advanceSelection(reads);
      reads.list?.abort();
      reads.detail?.abort();
      reads.selectedId = undefined;
      offContexts();
      offReference();
      offPickFinished?.();
    };
  }, [
    initialConversationId,
    bridge,
    open,
    refreshList,
    owner,
    tabKey,
    replaceDetail,
    setError,
    onPickFinished,
  ]);

  const conversationId = detail?.conversation.id;
  const settlingActionId = detail?.actions.find(
    (action) => action.status === "running",
  )?.id;
  useEffect(() => {
    if (!conversationId || !settlingActionId) return;
    const controller = new AbortController();
    const selection = readsRef.current.selection;
    let timer: number;
    const poll = async () => {
      const onScreen = () =>
        !controller.signal.aborted &&
        readsRef.current.selection === selection &&
        readsRef.current.selectedId === conversationId;
      if (!onScreen()) return;
      if (!isExecutingAction(settlingActionId)) {
        try {
          const snapshot = await fetchApiJson<Detail>(
            `/v1/amadeus/conversations/${conversationId}`,
            { signal: controller.signal },
          );
          if (!onScreen()) return;
          const action = snapshot.actions.find(
            (item) => item.id === settlingActionId,
          );
          replaceDetail(snapshot);
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
    bridge,
    conversationId,
    isExecutingAction,
    replaceDetail,
    settlingActionId,
  ]);

  useEffect(() => {
    if (hydratedTab.current !== tabKey) {
      hydratedTab.current = tabKey;
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

  // A conversation ID alone cannot detect leaving and then reopening it.
  const captureSelection = useCallback(() => {
    const reads = readsRef.current;
    const selection = reads.selection;
    return () =>
      mounted.current &&
      reads === readsRef.current &&
      reads.owner === owner &&
      reads.selection === selection;
  }, [owner]);
  const clearSelection = () => {
    const reads = readsRef.current;
    reads.detail?.abort();
    reads.selectedId = undefined;
    advanceSelection(reads);
    replaceDetail(null);
    setDraft("");
    setReferences([]);
    setRuns([]);
    writeTabState(tabKey, { id: null });
  };
  const selectionPending = () =>
    Boolean(readsRef.current.selectedId && !getDetail());
  const adopt = (next: Detail) => {
    readsRef.current.detail?.abort();
    advanceSelection(readsRef.current);
    readsRef.current.selectedId = next.conversation.id;
    replaceDetail(next);
    setRuns([]);
    writeTabState(`${tabKey}:draft:new`, { text: "", references: [] });
  };

  const updateDetail = useCallback(
    (isCurrent: () => boolean, update: (detail: Detail) => Detail) => {
      const current = getDetail();
      if (current && isCurrent()) replaceDetail(update(current));
    },
    [getDetail, replaceDetail],
  );

  const acceptRun = useCallback(
    (value: RunDetail) => {
      if (
        !mounted.current ||
        getDetail()?.conversation.id !== value.run.conversation_id
      )
        return;
      setRuns((previous) => {
        const index = previous.findIndex(({ run }) => run.id === value.run.id);
        return index < 0
          ? [...previous, value]
          : previous.map((item, i) => (i === index ? value : item));
      });
    },
    [getDetail],
  );

  const openRecoveredRun = useCallback(
    (id: string, isCurrent: () => boolean) => {
      if (isCurrent() && !initialConversationId && !readTabState(tabKey))
        return open(id);
    },
    [initialConversationId, open, tabKey],
  );

  const addReference = (reference: Reference, isCurrent: () => boolean) => {
    if (isCurrent())
      setReferences((previous) => mergeReferences(previous, [reference]));
  };
  const clearDraft = (isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    setDraft("");
    setReferences([]);
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
    conversations,
    detail,
    runs,
    draft,
    setDraft,
    references,
    setReferences,
    contexts,
    loaded,
    setLoaded,
    refreshList,
    open,
    captureSelection,
    selectionSignal: () => readsRef.current.selectionReads.signal,
    getDetail,
    adopt,
    selectionPending,
    clearSelection,
    updateDetail,
    acceptRun,
    openRecoveredRun,
    addReference,
    clearDraft,
  };
}
