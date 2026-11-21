import type { StoryboardWorkbench } from "./workbench";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  GripVertical,
  LayoutGrid,
  Rows3,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { apiErrorMessage } from "@platform/api/errors";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { SearchablePickerDialog } from "@shared/ui/SearchablePickerDialog";
import { useNavigationGuard } from "@shared/ui/navigationGuards";
import { LoadingState } from "@shared/ui/LoadingState";
import { OutputPreview } from "../board/OutputPreview";
import { cardsKey, listCards, getScript, scriptKey } from "../creative/api";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import { MaterialViews, type MaterialView } from "../board/MaterialViews";
import { BoardNodeEditor } from "../board/BoardNodeEditor";
import { OutputHistory } from "../board/OutputHistory";
import type { BoardController } from "../board/boardTypes";
import { useBoardGenerationTasks } from "../board/useBoardGenerationTasks";
import type { VisualNodeOutput } from "../api";
import "../board/project-board.css";
import "../board/workbench.css";
import { locateExcerpt } from "./scriptSource";
import { productionDraft } from "./productionDraft";
import type { VisualCanvasNode, VisualCanvasGenerationDraft } from "../api";
import {
  getStoryboard,
  saveStoryboard,
  type Shot,
  type Storyboard,
} from "./api";
import { emptyShot, importShots, reorderShots } from "./shotPlans";
import "./storyboard.css";

type Navigate = (action: () => void | Promise<void>) => void;
export default function StoryboardWorkspace({
  project,
  nodes,
  projectCardIds,
  renderHeader,
  onLocateNode,
  onCreateNode,
  onScript,
  beforeSave,
  readOnly = false,
  controller,
  onContentView,
  initialSelectedId,
  onSelection,
  onPrevis,
  renderWorkbench,
  activeWorkspace = true,
  onSelectedShot,
}: {
  renderWorkbench?: (content: StoryboardWorkbench) => ReactNode;
  activeWorkspace?: boolean;
  onSelectedShot?: (shot: Shot | undefined) => void;
  controller?: BoardController;
  onContentView?: (view: MaterialView) => void;
  initialSelectedId?: string;
  onSelection?: (id: string) => void;
  onPrevis?: (shot: Shot) => void | Promise<void>;
  project: string;
  nodes: VisualCanvasNode[];
  projectCardIds: string[];
  renderHeader: (busy: boolean, leave: Navigate, dirty: boolean) => ReactNode;
  onLocateNode: (nodeId: string) => void;
  onCreateNode: (
    kind: "image" | "video",
    title: string,
    draft: VisualCanvasGenerationDraft,
  ) => Promise<string>;
  beforeSave?: () => Promise<unknown>;
  onScript: (sceneId?: string, source?: Shot["source"]) => void;
  readOnly?: boolean;
}) {
  const client = useQueryClient();
  const key = keys.storyboard(project);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getStoryboard(project, signal),
  });
  const cards = useQuery({
    queryKey: cardsKey,
    queryFn: ({ signal }) => listCards(signal),
  });
  const script = useQuery({
    queryKey: scriptKey(project),
    queryFn: ({ signal }) => getScript(project, signal),
  });
  const [draft, setDraft] = useState<Storyboard>();
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? "");
  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [mediaKind, setMediaKind] = useState<"image" | "video">("video");
  const [previews, setPreviews] = useState<
    Record<string, VisualNodeOutput | undefined>
  >({});
  const activity = useBoardGenerationTasks(project, client);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<
    "import" | "cards" | "image" | "video"
  >();
  const [confirm, setConfirm] = useState<"delete" | "reload" | "source">();
  const flight = useRef(false);
  const leaving = useRef(false);
  const drag = useRef("");
  const current = draft ?? query.data;
  const shots = current?.shots ?? [];
  const scenes =
    script.data?.episodes.flatMap((episode) =>
      episode.scenes.map((scene) => ({
        id: scene.id,
        label: `${episode.title} / ${scene.title}`,
      })),
    ) ?? [];
  const shown = shots.filter(
    (shot) =>
      (!filter ||
        (filter === "unassigned"
          ? !shot.source
          : shot.source?.scene_id === filter)) &&
      `${shot.title} ${shot.description}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const selected = shown.find(({ id }) => id === selectedId) ?? shown[0];
  useEffect(() => {
    if (selected) onSelection?.(selected.id);
  }, [selected, onSelection]);
  const availableCards =
    cards.data?.filter(
      (card) => projectCardIds.includes(card.id) && !card.archived,
    ) ?? [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  useEffect(() => {
    onSelectedShot?.(selected);
  }, [selected, onSelectedShot]);
  const selectedIndex = shots.findIndex(({ id }) => id === selected?.id);
  function change(next: Shot[]) {
    if (current && !readOnly) setDraft({ ...current, shots: next });
  }
  function patch(value: Partial<Shot>) {
    if (selected)
      change(
        shots.map((shot) =>
          shot.id === selected.id ? { ...shot, ...value } : shot,
        ),
      );
  }
  async function persist(value: Storyboard) {
    await beforeSave?.();
    const saved = await saveStoryboard(project, value);
    client.setQueryData(key, saved);
    setDraft(undefined);
    return saved;
  }
  function commit(action?: () => void | Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        if (draft && !readOnly) await persist(draft);
        leaving.current = true;
        await action?.();
      } catch (failure) {
        setError(apiErrorMessage(failure));
      } finally {
        leaving.current = false;
        flight.current = false;
        setBusy(false);
      }
    })();
  }
  useNavigationGuard((resume) => {
    if (!activeWorkspace) return false;
    if (leaving.current || (!draft && !flight.current)) return false;
    commit(resume);
    return true;
  });
  useEffect(() => {
    if (!draft || !activeWorkspace) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, activeWorkspace]);
  function move(delta: number) {
    const other = shots[selectedIndex + delta];
    if (selected && other) change(reorderShots(shots, selected.id, other.id));
  }
  function generate(kind: "image" | "video") {
    if (!selected || !current || flight.current) return;
    const existing =
      kind === "image" ? selected.image_node_id : selected.video_node_id;
    if (existing && nodeById.has(existing)) {
      setMediaKind(kind);
      return;
    }
    flight.current = true;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const settings = await productionDraft(
          client,
          project,
          kind,
          selected,
          availableCards,
        );
        const identity = await onCreateNode(kind, selected.title, settings);
        const next = {
          ...current,
          shots: shots.map((shot) =>
            shot.id === selected.id
              ? {
                  ...shot,
                  [kind === "image" ? "image_node_id" : "video_node_id"]:
                    identity,
                }
              : shot,
          ),
        };
        setDraft(next); // A failed save retains the newly created link for retry.
        await persist(next);
        setMediaKind(kind);
      } catch (failure) {
        setError(apiErrorMessage(failure));
      } finally {
        leaving.current = false;
        flight.current = false;
        setBusy(false);
      }
    })();
  }
  const linkedNode =
    selected &&
    nodeById.get(
      (mediaKind === "video"
        ? selected.video_node_id
        : selected.image_node_id) ?? "",
    );
  const previewNode = linkedNode;
  const selectedForMedia = useRef(selected);
  selectedForMedia.current = selected;
  useEffect(() => {
    const selected = selectedForMedia.current;
    if (selected)
      setMediaKind(
        selected.video_node_id
          ? "video"
          : selected.image_node_id
            ? "image"
            : "video",
      );
  }, [selected?.id]);
  const sourceScene = script.data?.episodes
    .flatMap((episode) => episode.scenes)
    .find((scene) => scene.id === selected?.source?.scene_id);
  const sourceLocated =
    selected?.source && sourceScene
      ? locateExcerpt(sourceScene.text, selected.source)
      : undefined;
  const sourceCandidate =
    selected?.source?.start != null &&
    selected.source.end != null &&
    sourceScene
      ? sourceScene.text.slice(selected.source.start, selected.source.end)
      : "";
  const properties = selected ? (
    <aside className="storyboard-inspector" aria-label="分镜编辑">
      <div className="storyboard-inspector-heading">
        <h3>镜头 {String(selectedIndex + 1).padStart(3, "0")}</h3>
        {!readOnly && (
          <>
            <button
              aria-label="上移分镜"
              disabled={busy || Boolean(filter) || selectedIndex <= 0}
              onClick={() => move(-1)}
            >
              <ArrowUp size={16} />
            </button>
            <button
              aria-label="下移分镜"
              disabled={
                busy || Boolean(filter) || selectedIndex >= shots.length - 1
              }
              onClick={() => move(1)}
            >
              <ArrowDown size={16} />
            </button>
            <button
              aria-label="删除分镜"
              disabled={busy}
              onClick={() => setConfirm("delete")}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
      <fieldset disabled={busy || readOnly}>
        <label>
          镜头标题
          <input
            maxLength={120}
            value={selected.title}
            onChange={(event) => patch({ title: event.target.value })}
          />
        </label>
        <label>
          镜头描述
          <textarea
            rows={3}
            value={selected.description}
            maxLength={12000}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </label>
        <div className="storyboard-camera-fields">
          <label>
            景别
            <input
              value={selected.shot_size}
              maxLength={80}
              onChange={(event) => patch({ shot_size: event.target.value })}
            />
          </label>
          <label>
            运镜
            <input
              value={selected.camera_motion}
              maxLength={160}
              onChange={(event) => patch({ camera_motion: event.target.value })}
            />
          </label>
          <label>
            规划时长（秒）
            <input
              type="number"
              min="0.1"
              max="3600"
              step="0.1"
              value={selected.duration ?? ""}
              onChange={(event) =>
                patch({
                  duration: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            />
          </label>
        </div>
        <label>
          对白
          <textarea
            rows={2}
            maxLength={12000}
            value={selected.dialogue}
            onChange={(event) => patch({ dialogue: event.target.value })}
          />
        </label>
        <label>
          声音
          <textarea
            rows={2}
            maxLength={12000}
            value={selected.sound}
            onChange={(event) => patch({ sound: event.target.value })}
          />
        </label>
        <label>
          来源剧本
          <CustomSelect
            ariaLabel="关联剧本场次"
            value={selected.source?.scene_id ?? ""}
            onChange={(id) =>
              patch({
                source:
                  id && script.data
                    ? {
                        scene_id: id,
                        revision: script.data.revision,
                        excerpt: "",
                      }
                    : null,
              })
            }
            options={[
              { value: "", label: "未关联" },
              ...scenes.map((scene) => ({
                value: scene.id,
                label: scene.label,
              })),
              ...(selected.source &&
              !scenes.some((scene) => scene.id === selected.source?.scene_id)
                ? [
                    {
                      value: selected.source.scene_id,
                      label: "来源场次已删除",
                    },
                  ]
                : []),
            ]}
          />
        </label>
      </fieldset>
      {selected.source && (
        <>
          <small>
            {(
              selected.source.excerpt
                ? !sourceLocated
                : selected.source.revision !== script.data?.revision
            )
              ? "来源剧本已变化；镜头设计保留原版本，请核对后重新关联。"
              : `来源版本 v${selected.source.revision}`}
          </small>
          {selected.source.excerpt && (
            <blockquote>{selected.source.excerpt}</blockquote>
          )}
          {!readOnly &&
            selected.source.excerpt &&
            !sourceLocated &&
            sourceCandidate && (
              <button disabled={busy} onClick={() => setConfirm("source")}>
                核对并更新来源选段
              </button>
            )}
          <button
            onClick={() =>
              commit(() => onScript(selected.source?.scene_id, selected.source))
            }
          >
            定位剧本
          </button>
        </>
      )}
      <div className="storyboard-references">
        <h4>关联设定</h4>
        {selected.card_ids.map((id) => (
          <div key={id}>
            <span>
              {availableCards.find((card) => card.id === id)?.title ??
                "设定已移出项目"}
            </span>
            {!readOnly && (
              <button
                disabled={busy}
                aria-label={`解除设定 ${id}`}
                onClick={() =>
                  patch({
                    card_ids: selected.card_ids.filter((key) => key !== id),
                  })
                }
              >
                移除
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button disabled={busy} onClick={() => setPicker("cards")}>
            关联人设／场景／道具
          </button>
        )}
      </div>
      {(["image", "video"] as const).map((kind) => {
        const identity =
          kind === "image" ? selected.image_node_id : selected.video_node_id;
        const node = nodeById.get(identity ?? "");
        return (
          <div className="storyboard-production-link" key={kind}>
            <strong>{kind === "image" ? "分镜图" : "视频"}</strong>
            <span>
              {node?.title ??
                (identity ? "节点已删除，请重新关联" : "未关联制作节点")}
            </span>
            {!readOnly && (
              <>
                <button disabled={busy} onClick={() => setPicker(kind)}>
                  关联节点
                </button>
                <button disabled={busy} onClick={() => generate(kind)}>
                  {node ? "编辑生成" : "创建制作节点"}
                </button>
              </>
            )}
          </div>
        );
      })}
      {selected && onPrevis && (
        <button onClick={() => commit(() => onPrevis(selected))}>
          打开镜头白模预演
        </button>
      )}
      <div className="storyboard-selected-preview">
        {previewNode && previewNode.kind !== "text" && (
          <OutputPreview
            kind={previewNode.kind}
            assetId={previewNode.asset_id}
          />
        )}
      </div>
      <small>规划时长用于镜头设计；实际素材和输出版本仍由制作节点管理。</small>
    </aside>
  ) : null;
  const workbench: StoryboardWorkbench = {
    sidebar: (
      <>
        {query.isPending && (
          <LoadingState label="正在读取分镜…" variant="region" />
        )}
        {renderWorkbench && error && <p role="alert">{error}</p>}
        {renderWorkbench && query.isError && (
          <p role="alert">
            分镜读取失败。
            <button onClick={() => void query.refetch()}>重试</button>
          </p>
        )}{" "}
        <div className="storyboard-toolbar">
          <h2>
            <Clapperboard size={20} /> 分镜
          </h2>
          <div className="storyboard-view-tools">
            <CustomSelect
              ariaLabel="分镜场次"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "", label: "全部分镜" },
                { value: "unassigned", label: "未关联剧本" },
                ...scenes.map((scene) => ({
                  value: scene.id,
                  label: scene.label,
                })),
              ]}
            />
            <div role="group" aria-label="分镜显示方式">
              <button
                aria-pressed={view === "cards"}
                onClick={() => setView("cards")}
              >
                <LayoutGrid size={16} />
                <span>卡片</span>
              </button>
              <button
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
              >
                <Rows3 size={16} />
                <span>表格</span>
              </button>
            </div>
          </div>
          <small>
            {shots.length} 镜 · 规划{" "}
            {shots
              .reduce((sum, shot) => sum + (shot.duration ?? 0), 0)
              .toFixed(1)}{" "}
            秒
          </small>
          {!readOnly && (
            <>
              <button
                disabled={busy || !current || shots.length >= 1000}
                onClick={() => setPicker("import")}
              >
                纳入已有节点
              </button>
              <button
                disabled={busy || !current || shots.length >= 1000}
                onClick={() => {
                  const shot = emptyShot(`第${shots.length + 1}镜`);
                  change([...shots, shot]);
                  setFilter("");
                  setSelectedId(shot.id);
                }}
              >
                <Plus size={16} /> 新建分镜
              </button>
            </>
          )}
        </div>
        <section
          className={`storyboard-shots is-${view}`}
          aria-label="镜头列表"
        >
          {!shown.length && (
            <div className="storyboard-empty">
              <Clapperboard size={38} />
              <h3>{shots.length ? "没有匹配的分镜" : "还没有分镜"}</h3>
              <p>
                {shots.length
                  ? "调整搜索或场次筛选，查看其他镜头。"
                  : "为镜头建立分镜，或纳入画布中的图像和视频。"}
              </p>
            </div>
          )}
          {shown.map((shot) => {
            const node =
              nodeById.get(shot.image_node_id ?? "") ??
              nodeById.get(shot.video_node_id ?? "");
            return (
              <article
                key={shot.id}
                className={`storyboard-shot${selected?.id === shot.id ? " is-selected" : ""}`}
                draggable={!readOnly && !busy && !filter}
                onDragStart={() => {
                  drag.current = shot.id;
                }}
                onDragEnd={() => {
                  drag.current = "";
                }}
                onDragOver={(event) => {
                  if (!readOnly && !filter && drag.current)
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!readOnly && !busy && !filter)
                    change(reorderShots(shots, drag.current, shot.id));
                  drag.current = "";
                }}
              >
                <button
                  className="storyboard-shot-select"
                  aria-pressed={selected?.id === shot.id}
                  onClick={() => setSelectedId(shot.id)}
                >
                  <span className="storyboard-shot-number">
                    <GripVertical size={14} />
                    镜头 {String(shots.indexOf(shot) + 1).padStart(3, "0")}
                    <small>
                      {shot.duration ? `${shot.duration}s` : "未定时长"}
                    </small>
                  </span>
                  <span className="storyboard-shot-image">
                    {node && node.kind !== "text" ? (
                      <OutputPreview
                        kind={node.kind}
                        assetId={node.asset_id}
                        compact
                      />
                    ) : (
                      <Clapperboard size={32} />
                    )}
                  </span>
                  <strong>{shot.title}</strong>
                  <span className="storyboard-shot-description">
                    {shot.description || "待填写镜头描述"}
                  </span>
                  <small>
                    {[shot.shot_size, shot.camera_motion]
                      .filter(Boolean)
                      .join(" · ") || "待设计景别与运镜"}
                  </small>
                  <small>
                    {node && node.kind !== "text" && node.asset_id
                      ? `采用节点输出${node.final_version ? ` v${node.final_version}` : ""}`
                      : (shot.image_node_id || shot.video_node_id) && !node
                        ? "制作节点已删除"
                        : "待制作"}
                  </small>
                </button>
              </article>
            );
          })}
        </section>
        {!readOnly && (
          <footer className="storyboard-save-footer">
            {" "}
            <button
              className="storyboard-save"
              disabled={busy || !draft}
              onClick={() => commit()}
            >
              <Save size={16} /> {busy ? "保存中…" : "保存分镜"}
            </button>
            <small>{draft ? "有未保存的修改" : "暂无更改"}</small>
          </footer>
        )}
      </>
    ),
    editor: (
      <section className="storyboard-production-editor" aria-label="分镜制作">
        <header className="storyboard-production-heading">
          <h2>{selected?.title ?? "选择镜头"}</h2>
          <div role="group" aria-label="制作类型">
            {(["video", "image"] as const).map((kind) => (
              <button
                key={kind}
                aria-pressed={previewNode?.kind === kind}
                onClick={() => setMediaKind(kind)}
              >
                {kind === "video" ? "视频" : "分镜图"}
              </button>
            ))}
          </div>
          {previewNode && (
            <button onClick={() => commit(() => onLocateNode(previewNode.id))}>
              定位制作节点
            </button>
          )}
        </header>
        {controller && previewNode && !readOnly ? (
          <BoardNodeEditor
            key={previewNode.id}
            controller={controller}
            node={previewNode}
            pending={busy}
            onLegacyPick={() => undefined}
            onLegacyCreate={() => undefined}
            onCardHandled={() => undefined}
            generating={false}
          />
        ) : (
          <div className="storyboard-empty">
            <h3>
              {selected ? "关联制作节点后开始编辑" : "新建或选择一个镜头"}
            </h3>
            {selected && !readOnly && (
              <>
                <button onClick={() => setPicker(mediaKind)}>
                  关联已有节点
                </button>
                <button onClick={() => generate(mediaKind)} disabled={busy}>
                  创建{mediaKind === "video" ? "视频" : "图像"}制作节点
                </button>
              </>
            )}
          </div>
        )}
      </section>
    ),
    output: (
      <aside className="storyboard-production-output">
        {controller && previewNode && !readOnly ? (
          <OutputHistory
            key={previewNode.id}
            controller={controller}
            nodeId={previewNode.id}
            preview={previews[previewNode.id]}
            onPreview={(value) =>
              setPreviews((old) => ({ ...old, [previewNode.id]: value }))
            }
            tasks={activity.tasks.data ?? []}
            batches={activity.batches.data ?? []}
            properties={properties}
          />
        ) : (
          properties
        )}
      </aside>
    ),
    selected,
    count: shots.length,
    search,
    onSearch: setSearch,
    busy,
    dirty: Boolean(draft),
    leave: commit,
  };
  return (
    <div className="storyboard-workspace">
      {renderWorkbench ? (
        renderWorkbench(workbench)
      ) : (
        <>
          {renderHeader(busy, commit, Boolean(draft))}
          {error && (
            <div className="storyboard-notice" role="alert">
              {error}{" "}
              <button disabled={busy} onClick={() => setConfirm("reload")}>
                重新读取
              </button>
              <span>未保存的草稿仍保留在本页。</span>
            </div>
          )}
          {query.isError && (
            <p role="alert">
              分镜读取失败。
              <button onClick={() => void query.refetch()}>重试</button>
            </p>
          )}
          {query.isPending ? (
            <LoadingState label="正在读取分镜…" variant="region" />
          ) : (
            <main className="storyboard-layout storyboard-production-layout">
              <MaterialViews
                view="storyboard"
                onView={(value) => commit(() => onContentView?.(value))}
                onStoryboard={() => undefined}
                ids={projectCardIds}
                fileCount={nodes.length}
                search={search}
                onSearch={setSearch}
                footer={
                  <small>
                    {shots.length} 镜 ·{" "}
                    {shots.reduce((n, shot) => n + (shot.duration ?? 0), 0)} 秒
                  </small>
                }
              >
                {workbench.sidebar}
              </MaterialViews>
              {workbench.editor}
              {workbench.output}
            </main>
          )}
        </>
      )}
      {picker && (
        <SearchablePickerDialog
          title={
            picker === "import"
              ? "纳入已有节点（确认清单）"
              : picker === "cards"
                ? "关联项目设定"
                : "关联制作节点"
          }
          searchLabel="搜索项目内容"
          loading={picker === "cards" && cards.isPending}
          error={
            picker === "cards" && cards.isError
              ? apiErrorMessage(cards.error)
              : undefined
          }
          items={
            picker === "cards"
              ? availableCards
                  .filter((card) => !selected?.card_ids.includes(card.id))
                  .map((card) => ({
                    id: card.id,
                    label: card.title,
                    detail: card.kind,
                    preview: card.adopted_asset_id
                      ? `/v1/files/${card.adopted_asset_id}/thumbnail`
                      : undefined,
                  }))
              : nodes
                  .filter((node) =>
                    picker === "import"
                      ? node.kind === "image" || node.kind === "video"
                      : node.kind === picker,
                  )
                  .map((node) => ({
                    id: node.id,
                    label: node.title,
                    icon: node.kind === "text" ? undefined : node.kind,
                    disabled:
                      picker === "import" &&
                      shots.some((shot) => shot.origin_node_id === node.id),
                    detail: node.kind,
                  }))
          }
          onClose={() => setPicker(undefined)}
          clearLabel={
            picker === "image" || picker === "video" ? "解除关联" : undefined
          }
          onChoose={(item) => {
            if (picker === "cards") {
              if (selected && item)
                patch({ card_ids: [...selected.card_ids, item.id] });
            } else if (picker !== "import")
              patch({
                [picker === "image" ? "image_node_id" : "video_node_id"]:
                  item?.id ?? null,
              });
            setPicker(undefined);
          }}
          multi={
            picker === "import"
              ? {
                  confirmLabel: "纳入分镜",
                  max: 1000 - shots.length,
                  onChoose: (items) => {
                    change(
                      importShots(
                        shots,
                        items.flatMap(({ id }) => {
                          const node = nodeById.get(id);
                          return node ? [node] : [];
                        }),
                      ),
                    );
                    setFilter("");
                    setPicker(undefined);
                  },
                }
              : undefined
          }
        />
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm === "delete"
            ? "删除此分镜？"
            : confirm === "source"
              ? "更新来源选段？"
              : "重新读取分镜？"
        }
        description={
          confirm === "source" ? (
            <>
              <p>原选段：{selected?.source?.excerpt}</p>
              <p>当前范围：{sourceCandidate}</p>
              <p>确认仅更新剧本关联，提示词与实际素材保留。</p>
            </>
          ) : confirm === "delete" ? (
            "只删除镜头卡，关联节点、文件和输出版本会保留。"
          ) : (
            "将放弃本页未保存的分镜草稿并读取服务器版本。"
          )
        }
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          if (confirm === "delete")
            change(shots.filter(({ id }) => id !== selected?.id));
          else if (confirm === "source" && selected?.source && script.data)
            patch({
              source: {
                ...selected.source,
                excerpt: sourceCandidate,
                revision: script.data.revision,
              },
            });
          else {
            setDraft(undefined);
            setError("");
            void query.refetch();
          }
          setConfirm(undefined);
        }}
      />
    </div>
  );
}
