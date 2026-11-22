import type { StoryboardWorkbench } from "./workbench";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  GripVertical,
  Video,
  Link2,
  LocateFixed,
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
import { setCanvasAssetDragData } from "../canvas/canvasAssetDrag";
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
import { ShotPrevisAssociation } from "./ShotPrevisAssociation";
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
    kind: "video",
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
  const [previews, setPreviews] = useState<
    Record<string, VisualNodeOutput | undefined>
  >({});
  const activity = useBoardGenerationTasks(project, client);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<"import" | "video">();
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
  function generate() {
    if (selected && current) createVideo(selected, current);
  }
  function createVideo(shot: Shot, document: Storyboard, save = true) {
    if (flight.current || readOnly) return;
    const existing = shot.video_node_id;
    if (existing && nodeById.get(existing)?.kind === "video") return;
    flight.current = true;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const image = nodeById.get(shot.image_node_id ?? "");
        const settings = await productionDraft(
          client,
          project,
          shot,
          availableCards,
          image?.kind === "image" ? (image.asset_id ?? undefined) : undefined,
        );
        const identity = await onCreateNode("video", shot.title, settings);
        const next = {
          ...document,
          shots: document.shots.map((row) =>
            row.id === shot.id
              ? {
                  ...row,
                  video_node_id: identity,
                }
              : row,
          ),
        };
        setDraft(next); // A failed save retains the newly created link for retry.
        if (save) await persist(next);
      } catch (failure) {
        setError(apiErrorMessage(failure));
      } finally {
        leaving.current = false;
        flight.current = false;
        setBusy(false);
      }
    })();
  }
  const linkedNode = nodeById.get(selected?.video_node_id ?? "");
  const previewNode = linkedNode?.kind === "video" ? linkedNode : undefined;
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
          分镜描述
          <textarea
            aria-label="分镜描述"
            rows={3}
            value={selected.description}
            maxLength={12000}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </label>
        <label>
          来源剧本
          <CustomSelect
            ariaLabel="关联剧本分镜"
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
                      label: "来源分镜已删除",
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
      {previewNode && (
        <div className="storyboard-production-link">
          <strong>镜头视频</strong>
          <span>{previewNode.title}</span>
          {!readOnly && (
            <button disabled={busy} onClick={() => setPicker("video")}>
              关联节点
            </button>
          )}
        </div>
      )}
      <ShotPrevisAssociation
        key={selected.id}
        project={project}
        shot={selected}
        nodes={nodes}
        disabled={busy}
        readOnly={readOnly}
        onChange={(previs) => patch({ previs })}
        onOpen={onPrevis ? () => commit(() => onPrevis(selected)) : undefined}
        onOutput={(id) => commit(() => onLocateNode(id))}
      />
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
          <CustomSelect
            ariaLabel="剧本分镜"
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
                纳入已有视频
              </button>
              <button
                disabled={busy || !current || shots.length >= 1000}
                onClick={() => {
                  const shot = emptyShot(`第${shots.length + 1}镜`);
                  change([...shots, shot]);
                  setFilter("");
                  setSelectedId(shot.id);
                  if (current)
                    createVideo(
                      shot,
                      { ...current, shots: [...shots, shot] },
                      false,
                    );
                }}
              >
                <Plus size={16} /> 新建分镜
              </button>
            </>
          )}
        </div>
        <section className="storyboard-shots" aria-label="镜头列表">
          {!shown.length && (
            <div className="storyboard-empty">
              <Clapperboard size={38} />
              <h3>{shots.length ? "没有匹配的分镜" : "还没有分镜"}</h3>
              <p>
                {shots.length
                  ? "调整搜索或剧本分镜筛选，查看其他镜头。"
                  : "为镜头建立分镜，或纳入画布中的视频。"}
              </p>
            </div>
          )}
          {shown.map((shot) => {
            const linked = nodeById.get(shot.video_node_id ?? "");
            const node = linked?.kind === "video" ? linked : undefined;
            const image = nodeById.get(shot.image_node_id ?? "");
            const media = node?.asset_id
              ? node
              : image?.kind === "image"
                ? image
                : undefined;
            return (
              <article
                key={shot.id}
                className={`storyboard-shot${selected?.id === shot.id ? " is-selected" : ""}`}
                draggable={
                  !readOnly && !busy && (!filter || Boolean(media?.asset_id))
                }
                onDragStart={(event) => {
                  drag.current = filter ? "" : shot.id;
                  if (media?.asset_id) {
                    setCanvasAssetDragData(event.dataTransfer, {
                      assetId: media.asset_id,
                      mediaKind: media.kind,
                      displayName: shot.title,
                      importMode: "none",
                      sourceProjectId: project,
                    });
                    event.dataTransfer.effectAllowed = "copyMove";
                  }
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
                    {node ? (
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
                    {node?.asset_id
                      ? `采用节点输出${node.final_version ? ` v${node.final_version}` : ""}`
                      : shot.video_node_id && !node
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
          {previewNode && (
            <button
              type="button"
              aria-label="定位制作节点"
              title="在画布中定位"
              onClick={() => commit(() => onLocateNode(previewNode.id))}
            >
              <LocateFixed size={16} aria-hidden />
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
        ) : selected && !previewNode ? (
          <div className="storyboard-design-sheet">{properties}</div>
        ) : previewNode ? (
          <OutputPreview kind="video" assetId={previewNode.asset_id} />
        ) : (
          <div className="storyboard-empty">
            <h3>新建或选择一个镜头</h3>
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
        ) : selected && !previewNode ? (
          <section
            className="storyboard-production-start"
            aria-label="制作镜头视频"
          >
            <header>
              <h3>镜头视频</h3>
              <span>待制作</span>
            </header>
            <div className="storyboard-start-preview">
              <Video size={32} strokeWidth={1.3} aria-hidden />
              <strong>为这一镜添加画面</strong>
              <p>先完善镜头设计，再开始制作镜头视频。</p>
            </div>
            {selected.video_node_id && (
              <p role="status">原镜头视频已不可用，请重新添加。</p>
            )}
            {!readOnly ? (
              <div className="storyboard-start-actions">
                <button className="primary" disabled={busy} onClick={generate}>
                  <Plus size={16} aria-hidden />
                  {busy ? "准备中…" : "开始制作镜头视频"}
                </button>
                <button disabled={busy} onClick={() => setPicker("video")}>
                  <Link2 size={16} aria-hidden />
                  关联已有视频
                </button>
              </div>
            ) : (
              <p>此镜头尚未添加镜头视频。</p>
            )}
          </section>
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
            picker === "import" ? "纳入已有视频（确认清单）" : "关联镜头视频"
          }
          searchLabel="搜索项目内容"
          items={nodes
            .filter(
              (node): node is Extract<VisualCanvasNode, { kind: "video" }> =>
                node.kind === "video" &&
                (picker === "import" ||
                  !shots.some(
                    (shot) =>
                      shot.id !== selected?.id &&
                      shot.video_node_id === node.id,
                  )),
            )
            .map((node) => ({
              id: node.id,
              label: node.title,
              icon: "video" as const,
              preview: node.asset_id
                ? `/v1/files/${encodeURIComponent(node.asset_id)}/thumbnail`
                : undefined,
              disabled:
                picker === "import" &&
                shots.some(
                  (shot) =>
                    shot.origin_node_id === node.id ||
                    shot.video_node_id === node.id,
                ),
              detail: node.kind,
            }))}
          onClose={() => setPicker(undefined)}
          onChoose={(item) => {
            if (picker !== "import")
              patch({
                video_node_id: item?.id ?? null,
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
