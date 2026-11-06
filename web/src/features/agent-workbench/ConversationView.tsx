import { LoadingScene } from "@shared/ui/LoadingScene";
import { LoadingState } from "@shared/ui/LoadingState";
import { useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowDown, FileCode2 } from "lucide-react";
import { AgentLogo } from "@features/code-agents";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  getHistory,
  agentName,
  type Conversation,
  type HistoryEntry,
  type HistoryCursor,
} from "./api";
import { HistoryTranscript } from "./HistoryTranscript";
import { workbenchKeys } from "./queryKeys";
import { HistorySourcePane, type FileAccess } from "./HistorySourcePane";
import type { FileReference } from "./fileReferences";
import { createPortal } from "react-dom";
import "./conversation.css";

export function ConversationView({
  item,
  owner,
  paused,
  readerHost,
  onOpenReader,
  onCloseReader,
  fileAccess,
}: {
  item: Conversation;
  owner: string;
  paused: boolean;
  readerHost?: HTMLElement | null;
  onOpenReader?: () => void;
  onCloseReader?: () => void;
  fileAccess?: FileAccess;
}) {
  const [file, setFile] = useState<FileReference>();
  const trigger = useRef<HTMLElement | null>(null);
  const closeFile = () => {
    setFile(undefined);
    onCloseReader?.();
    requestAnimationFrame(() => {
      const current = trigger.current;
      const replacement = [
        ...(scroller.current?.querySelectorAll<HTMLElement>(
          "button[data-file-path]",
        ) ?? []),
      ].find(
        (node) =>
          node.dataset.filePath === file?.path &&
          (node.dataset.fileLine ?? "") === (file?.line?.toString() ?? ""),
      );
      (current?.isConnected ? current : replacement)?.focus({
        preventScroll: true,
      });
    });
  };
  const reader = file && (
    <HistorySourcePane
      key={`${item.id}:${file.path}:${file.line}`}
      owner={owner}
      sessionId={item.id}
      target={file}
      close={closeFile}
      access={fileAccess}
    />
  );
  const [branch, setBranch] = useState<string>();
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<{
    ids: string[];
    offset: number;
    height: number;
  } | null>(null);
  const history = useInfiniteQuery({
    queryKey: workbenchKeys.history(owner, item.id, branch),
    queryFn: ({ pageParam, signal }) =>
      getHistory(item.id, pageParam, branch, signal),
    initialPageParam: undefined as HistoryCursor | undefined,
    getNextPageParam: (page) =>
      page.next_cursor == null
        ? undefined
        : {
            ordinal: page.next_cursor,
            nativeId: page.next_cursor_native_id ?? undefined,
            branch: page.selected_branch ?? undefined,
          },
    refetchOnWindowFocus: !paused,
  });
  const pages = history.data?.pages ?? [];
  const unique = new Map<string, HistoryEntry>();
  [...pages]
    .reverse()
    .forEach((page) =>
      page.items.forEach((entry) => unique.set(entry.id, entry)),
    );
  const messages = [...unique.values()].sort(
    (a, b) =>
      a.ordinal - b.ordinal ||
      (a.native_id < b.native_id ? -1 : a.native_id > b.native_id ? 1 : 0),
  );
  const version = history.dataUpdatedAt;
  const seenVersion = useRef(0);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (anchor.current) {
      const { ids, offset, height } = anchor.current;
      const entry = [
        ...node.querySelectorAll<HTMLElement>("[data-entry-id]"),
      ].find(
        (element) =>
          element.dataset.entryId?.split(" ").some((id) => ids.includes(id)) &&
          element.getClientRects().length,
      );
      node.scrollTop += entry
        ? entry.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          offset
        : node.scrollHeight - height;
      anchor.current = null;
    } else if (atBottom) {
      node.scrollTop = node.scrollHeight;
    } else if (version && seenVersion.current !== version) setHasNew(true);
    seenVersion.current = version;
  }, [version, atBottom]);
  const toBottom = () => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
    setAtBottom(true);
    setHasNew(false);
  };
  const branches = pages[0]?.branches ?? [];
  return (
    <>
      {branches.length > 1 && (
        <div className="aw-branch">
          <span>会话分支</span>
          <CustomSelect
            ariaLabel="Pi 会话分支"
            value={branch ?? pages[0]?.selected_branch ?? ""}
            options={branches.map((id, index) => ({
              value: id,
              label: `分支 ${index + 1} · ${id.slice(0, 12)}`,
            }))}
            onChange={(id) => {
              setBranch(id);
              setHasNew(false);
              setAtBottom(true);
            }}
          />
        </div>
      )}
      <div
        className={`aw-history-content${file && !readerHost ? " has-source" : ""}`}
      >
        <div className="aw-history-transcript">
          <div
            className="aw-messages"
            ref={scroller}
            aria-label="会话记录"
            onScroll={() => {
              const node = scroller.current;
              if (node) {
                const bottom =
                  node.scrollHeight - node.scrollTop - node.clientHeight < 64;
                setAtBottom(bottom);
                if (bottom) setHasNew(false);
              }
            }}
          >
            {history.hasNextPage && (
              <button
                className="aw-load"
                disabled={history.isFetchingNextPage}
                onClick={() => {
                  const node = scroller.current;
                  if (node) {
                    const top = node.getBoundingClientRect().top;
                    const entry = [
                      ...node.querySelectorAll<HTMLElement>("[data-entry-id]"),
                    ].find(
                      (element) => element.getBoundingClientRect().bottom > top,
                    );
                    anchor.current = {
                      ids: entry?.dataset.entryId?.split(" ") ?? [],
                      offset: entry
                        ? entry.getBoundingClientRect().top - top
                        : 0,
                      height: node.scrollHeight,
                    };
                  }
                  void history.fetchNextPage().then((result) => {
                    if (result.isFetchNextPageError) anchor.current = null;
                  });
                }}
              >
                {history.isFetchingNextPage ? (
                  <LoadingState variant="inline" label="正在加载…" />
                ) : (
                  "加载更早记录"
                )}
              </button>
            )}
            {history.isPending && (
              <div className="aw-empty">
                <LoadingScene />
                正在读取会话…
              </div>
            )}
            {history.error && (
              <div className="aw-error" role="alert">
                {history.error.message}
                <button
                  className="aw-link"
                  onClick={() => void history.refetch()}
                >
                  重新读取
                </button>
              </div>
            )}
            {!history.isPending && !history.error && !messages.length && (
              <div className="aw-empty">
                <FileCode2 size={32} />
                <strong>暂无可展示消息</strong>
                <p>
                  同步到完整记录后会自动显示。部分工具仅在一轮结束后保存内容。
                </p>
              </div>
            )}
            <HistoryTranscript
              key={branch ?? "latest"}
              messages={messages}
              item={item}
              onOpenFile={(target) => {
                trigger.current =
                  document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
                setFile(target);
                onOpenReader?.();
              }}
            />
          </div>
          {hasNew && (
            <button className="aw-new" onClick={toBottom}>
              <ArrowDown size={14} />
              有新内容
            </button>
          )}
          <footer className="aw-readonly">
            <AgentLogo id={item.agent_id} size={15} />
            <span>{item.native_model || agentName(item.agent_id)}</span>
            <span>· 只读 · {paused ? "已暂停当前视图跟随" : "自动同步"}</span>
          </footer>
        </div>
        {readerHost ? createPortal(reader, readerHost) : reader}
      </div>
    </>
  );
}
