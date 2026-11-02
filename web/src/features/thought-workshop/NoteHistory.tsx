import { LoadingState } from "@shared/ui/LoadingState";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, History, X } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import {
  listCheckpoints,
  createCheckpoint,
  renameCheckpoint,
  deleteCheckpoint,
  type Checkpoint,
} from "./knowledge-tools/api";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { ApiError } from "@platform/api/client";
import type { Note } from "./api";
import {
  getHistory,
  historyTime,
  listHistory,
  restoreHistory,
} from "./historyApi";
import { thoughtKeys } from "./queryKeys";
import { historyDiff } from "./historyDiff";
import "./history.css";

const RichEditor = lazy(() =>
  import("./RichEditor").then((m) => ({ default: m.RichEditor })),
);
export function NoteHistory({
  note,
  close,
  restored,
  conflict,
}: {
  note: Note;
  close: () => void;
  restored: (note: Note) => void;
  conflict: (note: Note) => void;
}) {
  const [baseline, setBaseline] = useState<string>("");
  const [checkpointInput, setCheckpointInput] = useState<
    Checkpoint | "create" | null
  >(null);
  const checkpoints = useQuery({
    queryKey: thoughtKeys.checkpoints(note.id),
    queryFn: () => listCheckpoints(note.id),
    retry: false,
  });
  const [selected, setSelected] = useState<string>();
  const [showChanges, setShowChanges] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(-1);
  const content = useRef<HTMLElement>(null);
  const drawerRef = useDrawerFocus<HTMLElement>(() => setDrawer(false), drawer);
  const history = useInfiniteQuery({
    queryKey: thoughtKeys.history(note.id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => listHistory(note.id, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 0,
  });
  const records = history.data?.pages.flatMap((page) => page.items) ?? [];
  const recordId = selected ?? records[0]?.id;
  const detail = useQuery({
    queryKey: thoughtKeys.historyDetail(note.id, recordId ?? ""),
    queryFn: ({ signal }) => getHistory(note.id, recordId!, signal),
    enabled: !!recordId,
  });
  const compare = useQuery({
    queryKey: thoughtKeys.historyDetail(note.id, baseline),
    queryFn: ({ signal }) => getHistory(note.id, baseline, signal),
    enabled: !!baseline,
  });
  const current = detail.data?.current,
    previous = baseline ? compare.data?.current : detail.data?.previous;
  const diff = useMemo(
    () => (current ? historyDiff(current.document, previous?.document) : null),
    [current, previous],
  );
  const titleChanged = !!previous && previous.title !== current?.title;
  const tagsChanged =
    !!previous &&
    JSON.stringify(previous.tags) !== JSON.stringify(current?.tags);
  const count =
    (diff?.marks.length ?? 0) + Number(titleChanged) + Number(tagsChanged);
  const navigate = (direction: number) => {
    const targets = Array.from(
      content.current?.querySelectorAll<HTMLElement>("[data-history-change]") ??
        [],
    );
    const unique = targets.filter(
      (item, i) =>
        targets.findIndex(
          (other) => other.dataset.historyChange === item.dataset.historyChange,
        ) === i,
    );
    if (!unique.length) return;
    const next =
      position < 0
        ? direction > 0
          ? 0
          : unique.length - 1
        : (position + direction + unique.length) % unique.length;
    unique[next].scrollIntoView({ block: "center", behavior: "smooth" });
    setPosition(next);
  };
  return (
    <div className="thought-history-workspace">
      <section
        className="thought-document"
        ref={content}
        aria-label="历史文档预览"
      >
        <header className="thought-document-bar thought-history-toolbar">
          <button className="btn" onClick={close} disabled={pending}>
            <ArrowLeft size={15} /> 返回文档
          </button>
          <span className="thought-history-meta">
            {current
              ? `${historyTime(current.created_at, true)} ${historyTime(current.created_at)} · ${current.author_name}`
              : "加载历史记录…"}
          </span>
          <button
            className="btn"
            aria-label="上一处修改"
            disabled={!showChanges || !count}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="thought-change-count">
            {showChanges && count
              ? `${position < 0 ? "—" : position + 1} / ${count}`
              : "无更改"}
          </span>
          <button
            className="btn"
            aria-label="下一处修改"
            disabled={!showChanges || !count}
            onClick={() => navigate(1)}
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="btn thought-history-mobile"
            onClick={() => setDrawer(true)}
          >
            <History size={15} /> 记录
          </button>
          <button
            className="btn primary"
            disabled={pending || !current || current.id === records[0]?.id}
            onClick={() => setConfirm(true)}
          >
            还原此记录
          </button>
        </header>
        <div className="thought-tools">
          <CustomSelect
            ariaLabel="历史比较基准"
            value={baseline}
            options={[
              { value: "", label: "前一个版本" },
              ...records.map((record) => ({
                value: record.id,
                label: `版本 ${record.revision} · ${historyTime(record.created_at, true)}`,
              })),
            ]}
            onChange={setBaseline}
          />
          {history.hasNextPage && (
            <button
              className="btn"
              onClick={() => void history.fetchNextPage()}
            >
              加载更多版本
            </button>
          )}
          <button
            className="btn"
            disabled={!current}
            onClick={() => setCheckpointInput("create")}
          >
            命名此快照
          </button>
          {checkpoints.data?.map((checkpoint) => (
            <span key={checkpoint.id}>
              <button
                className="btn"
                onClick={() => setSelected(checkpoint.history_id)}
              >
                {checkpoint.name}
              </button>
              <button
                className="btn small"
                aria-label={`重命名快照${checkpoint.name}`}
                onClick={() => setCheckpointInput(checkpoint)}
              >
                改名
              </button>
              <button
                className="btn small"
                aria-label={`删除快照标记${checkpoint.name}`}
                onClick={() =>
                  void deleteCheckpoint(checkpoint)
                    .then(() => checkpoints.refetch())
                    .catch((error) => setError(String(error)))
                }
              >
                删除标记
              </button>
            </span>
          ))}
          {compare.error && <p role="alert">{compare.error.message}</p>}
        </div>
        <TextInputDialog
          open={!!checkpointInput}
          title={checkpointInput === "create" ? "命名历史快照" : "重命名快照"}
          label="快照名称"
          initialValue={
            checkpointInput && checkpointInput !== "create"
              ? checkpointInput.name
              : ""
          }
          onCancel={() => setCheckpointInput(null)}
          onConfirm={(name) => {
            const input = checkpointInput;
            setCheckpointInput(null);
            void (
              input === "create" && current
                ? createCheckpoint(note.id, {
                    name,
                    history_id: current.id,
                    expected_note_revision: note.revision,
                  })
                : input && input !== "create"
                  ? renameCheckpoint(input, name)
                  : Promise.resolve()
            )
              .then(() => checkpoints.refetch())
              .catch((error) => setError(String(error)));
          }}
        />
        <div className="thought-history-options">
          <span>
            {previous
              ? `与 ${historyTime(previous.created_at, true)} ${historyTime(previous.created_at)} 的记录比较`
              : "历史起点，无更早记录"}{" "}
            · 只读
          </span>
          <button
            className="thought-history-switch"
            role="switch"
            aria-checked={showChanges}
            onClick={() => {
              setShowChanges(!showChanges);
              setPosition(-1);
            }}
          >
            <span /> 显示更改
          </button>
        </div>
        {error && (
          <p className="thought-error" role="alert">
            {error}
          </p>
        )}
        {checkpoints.error && (
          <p className="thought-error" role="alert">
            {checkpoints.error.message}
            <button className="btn" onClick={() => void checkpoints.refetch()}>
              重试快照标记
            </button>
          </p>
        )}
        {detail.isError && (
          <p className="thought-error" role="alert">
            {detail.error.message}{" "}
            <button className="btn" onClick={() => void detail.refetch()}>
              重试
            </button>
          </p>
        )}
        {current && diff && (
          <Suspense
            fallback={<LoadingState label="文档加载中…" variant="region" />}
          >
            <RichEditor
              libraryId={note.knowledge_base_id}
              key={current.id}
              document={showChanges ? diff.document : current.document}
              historyMarks={showChanges ? diff.marks : undefined}
              historyAuthor={current.author_name}
              readOnly
              onChange={() => {}}
              onReady={() => {}}
              beforeContent={
                <div className="thought-note-heading">
                  <h1
                    className="thought-history-title"
                    data-history-change={
                      showChanges && titleChanged ? "title" : undefined
                    }
                  >
                    {showChanges && titleChanged && (
                      <del>{previous?.title}</del>
                    )}{" "}
                    <span
                      className={
                        showChanges && titleChanged
                          ? "thought-history-change is-added"
                          : ""
                      }
                    >
                      {current.title}
                    </span>
                  </h1>
                  <div
                    className="thought-note-tags"
                    data-history-change={
                      showChanges && tagsChanged ? "tags" : undefined
                    }
                  >
                    {showChanges &&
                      tagsChanged &&
                      previous?.tags
                        .filter((tag) => !current.tags.includes(tag))
                        .map((tag) => (
                          <del key={tag} className="thought-tag">
                            {tag}
                          </del>
                        ))}
                    {current.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`thought-tag ${showChanges && previous && !previous.tags.includes(tag) ? "thought-history-change is-added" : ""}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  {showChanges && count > 0 && (
                    <small className="thought-history-author">
                      {current.author_name} · {count}{" "}
                      处修改（下划线为新增，删除线为删除）
                    </small>
                  )}
                </div>
              }
            />
          </Suspense>
        )}
      </section>
      {drawer && (
        <button
          className="thought-history-backdrop"
          aria-label="关闭历史列表"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        ref={drawerRef}
        className={`thought-history-list ${drawer ? "is-open" : ""}`}
        aria-label="历史记录"
      >
        <header>
          <h2>历史记录</h2>
          <button
            className="btn"
            aria-label="关闭历史列表"
            onClick={() => {
              if (window.matchMedia("(max-width: 1200px)").matches)
                setDrawer(false);
              else close();
            }}
          >
            <X size={17} />
          </button>
        </header>
        <p>选择记录，查看当时的文档与更改</p>
        {history.isError && (
          <p role="alert">
            {history.error.message}{" "}
            <button className="btn" onClick={() => void history.refetch()}>
              重试
            </button>
          </p>
        )}
        {history.isPending && <LoadingState label="加载中…" variant="region" />}
        {[
          ...new Set(records.map((row) => historyTime(row.created_at, true))),
        ].map((date) => (
          <details open key={date}>
            <summary>{date}</summary>
            {records
              .filter((row) => historyTime(row.created_at, true) === date)
              .map((row) => (
                <button
                  key={row.id}
                  className={`thought-history-row ${row.id === recordId ? "is-selected" : ""}`}
                  aria-pressed={row.id === recordId}
                  disabled={pending}
                  onClick={() => {
                    setSelected(row.id);
                    setPosition(-1);
                    setDrawer(false);
                    setError("");
                  }}
                >
                  <span className="thought-history-dot" />
                  <span>
                    <strong>
                      {historyTime(row.created_at)}
                      {row.id === records[0]?.id ? " · 当前版本" : ""}
                    </strong>
                    <span>{row.author_name}</span>
                    <small>{row.summary}</small>
                  </span>
                </button>
              ))}
          </details>
        ))}
        {history.hasNextPage && (
          <button
            className="btn"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            展开更多历史记录
          </button>
        )}
      </aside>
      <ConfirmDialog
        open={confirm}
        title="还原此历史记录？"
        description={
          <>
            将标题、正文和标签还原至{" "}
            {current &&
              `${historyTime(current.created_at, true)} ${historyTime(current.created_at)}`}
            。当前内容仍保留在历史记录中。
          </>
        }
        confirmLabel="还原"
        pending={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          if (!current || pending) return;
          setPending(true);
          setError("");
          try {
            restored(await restoreHistory(note.id, current.id, note.revision));
          } catch (e) {
            setConfirm(false);
            if (
              e instanceof ApiError &&
              e.status === 409 &&
              e.problem.current
            ) {
              conflict(e.problem.current as Note);
            } else
              setError(e instanceof Error ? e.message : "还原失败，请重试");
          } finally {
            setPending(false);
          }
        }}
      />
    </div>
  );
}
