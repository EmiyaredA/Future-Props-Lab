import { BoardMenu } from "../board/BoardMenu";
import { ScriptDirectory } from "./ScriptDirectory";
import { ScriptEpisodeOverview } from "./ScriptEpisodeOverview";
import type { VisualCanvasNode } from "../api";
import { WorkspaceSidebar } from "../WorkspaceSidebar";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Box,
  Clapperboard,
  ChevronRight,
  FileText,
  Save,
  Shapes,
  X,
} from "lucide-react";
import { apiErrorMessage } from "@platform/api/errors";
import { useNavigationGuard } from "@shared/ui/navigationGuards";
import {
  getScript,
  saveScript,
  scriptKey,
  type Script,
  type ScriptScene,
  type ScriptSeed,
} from "./api";
import { getStoryboard, saveStoryboard, type Shot } from "../storyboard/api";
import { emptyShot } from "../storyboard/shotPlans";
import { locateExcerpt } from "../storyboard/scriptSource";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import { ScriptCardExtraction } from "./ScriptCardExtraction";
import "../previs/previs.css";
import "./creative.css";

type Navigate = (action: () => void | Promise<void>) => void;

const exampleScene = {
  heading: "室内 · 咖啡馆 · 夜",
  text: [
    "中景，固定机位，约8秒。咖啡馆角落亮着暖灯，桌上放着两杯咖啡和一封尚未拆开的信。",
    "林舟将信封轻轻推向对面的苏晚。苏晚放下咖啡杯，抬眼看向他。",
    "林舟：这封信是今天下午收到的，你先看看。",
    "苏晚：寄信的人，有留下名字吗？",
    "声音：窗外细雨、杯子轻放在桌面的声音。",
  ].join("\n\n"),
};

function move<T>(
  items: T[],
  id: (item: T) => string,
  active: string,
  delta: number,
) {
  const from = items.findIndex((item) => id(item) === active);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return items;
  const ordered = [...items];
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  return ordered;
}

export default function ScriptWorkspace({
  project,
  nodes = [],
  readOnly = false,
  activeWorkspace = true,
  renderHeader,
  onPrevis,
  initialSceneId,
  initialSource,
  onStoryboard,
  onPrepareShot,
  beforeStoryboardSave,
}: {
  project: string;
  nodes?: VisualCanvasNode[];
  initialSceneId?: string;
  initialSource?: Shot["source"];
  onStoryboard?: (id?: string) => void;
  onPrepareShot?: (shot: Shot) => Promise<Shot>;
  beforeStoryboardSave?: () => Promise<unknown>;
  readOnly?: boolean;
  activeWorkspace?: boolean;
  renderHeader?: (
    busy: boolean,
    navigate: Navigate,
    dirty: boolean,
  ) => ReactNode;
  onPrevis?: (seed: ScriptSeed) => void;
}) {
  const client = useQueryClient();
  const key = scriptKey(project);
  const script = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getScript(project, signal),
  });
  const board = useQuery({
    queryKey: keys.storyboard(project),
    queryFn: ({ signal }) => getStoryboard(project, signal),
  });
  const textInput = useRef<HTMLTextAreaElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<{
    scene: string;
    start: number;
    end: number;
  }>();
  const [linksOpen, setLinksOpen] = useState(false);
  const [target, setTarget] = useState("");
  const pendingShot = useRef<Shot | undefined>(undefined);
  const [draft, setDraft] = useState<Script>();
  const current = draft ?? script.data;
  const [episodeId, setEpisodeId] = useState("");
  const [overview, setOverview] = useState(false);
  const [sceneId, setSceneId] = useState(initialSceneId ?? "");
  useEffect(() => {
    if (initialSceneId) {
      setSceneId(initialSceneId);
      setEpisodeId("");
      setOverview(false);
    }
  }, [initialSceneId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extract, setExtract] = useState<ScriptSeed>();
  const [deleting, setDeleting] = useState<{
    episode: string;
    scene?: string;
  }>();
  const [reloadOpen, setReloadOpen] = useState(false);
  const flight = useRef(false);
  const leaving = useRef(false);
  const episode =
    current?.episodes.find((item) => item.id === episodeId) ??
    current?.episodes.find((item) =>
      item.scenes.some((scene) => scene.id === sceneId),
    ) ??
    current?.episodes[0];
  const scene = overview
    ? undefined
    : (episode?.scenes.find((item) => item.id === sceneId) ??
      episode?.scenes[0]);

  const activeScene = useRef(scene);
  activeScene.current = scene;
  useEffect(() => {
    const scene = activeScene.current;
    if (!scene || scene.id !== initialSceneId || !initialSource) return;
    const range = locateExcerpt(scene.text, initialSource);
    if (range) {
      textInput.current?.focus();
      textInput.current?.setSelectionRange(range.start, range.end);
      setSelection({ scene: scene.id, ...range });
    }
  }, [scene?.id, initialSceneId, initialSource]);

  useEffect(() => {
    if (!draft || !activeWorkspace) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, activeWorkspace]);

  function commit(action?: (saved?: Script) => void | Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        let saved = current;
        if (draft && !readOnly) {
          saved = await saveScript(project, draft);
          client.setQueryData(key, saved);
          setDraft(undefined);
        }
        leaving.current = true;
        try {
          await action?.(saved);
        } finally {
          leaving.current = false;
        }
      } catch (failure) {
        setError(apiErrorMessage(failure));
      } finally {
        flight.current = false;
        setBusy(false);
      }
    })();
  }

  useNavigationGuard((resume) => {
    if (!activeWorkspace) return false;
    if (leaving.current || (!draft && !flight.current)) return false;
    commit(() => resume());
    return true;
  });

  function updateEpisodes(episodes: Script["episodes"]) {
    if (current && !readOnly) setDraft({ ...current, episodes });
  }

  function changeEpisode(patch: Partial<Script["episodes"][number]>) {
    if (current && episode)
      updateEpisodes(
        current.episodes.map((item) =>
          item.id === episode.id ? { ...item, ...patch } : item,
        ),
      );
  }

  const deleteEpisode = current?.episodes.find(
    (item) => item.id === deleting?.episode,
  );
  const deleteScene = deleteEpisode?.scenes.find(
    (item) => item.id === deleting?.scene,
  );
  function deleteEntry() {
    if (readOnly || busy || flight.current || !current || !deleteEpisode)
      return;
    if (deleting?.scene) {
      if (!deleteScene) return;
      const remaining = deleteEpisode.scenes.filter(
        (item) => item.id !== deleteScene.id,
      );
      updateEpisodes(
        current.episodes.map((item) =>
          item.id === deleteEpisode.id ? { ...item, scenes: remaining } : item,
        ),
      );
      if (scene?.id === deleteScene.id) {
        const index = deleteEpisode.scenes.indexOf(deleteScene);
        setEpisodeId(deleteEpisode.id);
        setSceneId(remaining[Math.min(index, remaining.length - 1)]?.id ?? "");
        setSelection(undefined);
      }
    } else {
      const remaining = current.episodes.filter(
        (item) => item.id !== deleteEpisode.id,
      );
      updateEpisodes(remaining);
      if (episode?.id === deleteEpisode.id) {
        const index = current.episodes.indexOf(deleteEpisode);
        const next = remaining[Math.min(index, remaining.length - 1)];
        setEpisodeId(next?.id ?? "");
        setSceneId(next?.scenes[0]?.id ?? "");
        setSelection(undefined);
      }
    }
    setDeleting(undefined);
    requestAnimationFrame(() => {
      const next =
        textInput.current ??
        workspace.current?.querySelector<HTMLElement>(
          ".script-episode-tools input, .visual-previs-scenes-heading button",
        );
      next?.focus();
    });
  }

  function changeScene(patch: Partial<ScriptScene>) {
    if (episode && scene)
      changeEpisode({
        scenes: episode.scenes.map((item) =>
          item.id === scene.id ? { ...item, ...patch } : item,
        ),
      });
  }

  function handoff(action: (seed: ScriptSeed) => void) {
    if (!scene) return;
    commit((saved) => {
      if (saved)
        action({
          scene,
          source: { scene_id: scene.id, revision: saved.revision },
        });
    });
  }

  const related = (board.data?.shots ?? []).filter((shot) =>
    scene
      ? shot.source?.scene_id === scene.id
      : overview &&
        episode?.scenes.some((entry) => entry.id === shot.source?.scene_id),
  );
  const range = selection?.scene === scene?.id ? selection : undefined;
  function captureSelection(input: HTMLTextAreaElement) {
    if (!scene) return;
    if (input.selectionEnd > input.selectionStart) setLinksOpen(true);
    setSelection({
      scene: scene.id,
      start: input.selectionStart,
      end: input.selectionEnd,
    });
  }
  function linkSelection() {
    if (!scene || !range || range.end <= range.start) return;
    const excerpt = scene.text.slice(range.start, range.end);
    commit(async (saved) => {
      if (!saved) return;
      const latest = await getStoryboard(project);
      const previous = target
        ? latest.shots.find((shot) => shot.id === target)
        : undefined;
      if (target && !previous) throw new Error("目标镜头已删除，请重新选择");
      let shot: Shot = {
        ...(previous ?? emptyShot(excerpt.slice(0, 32))),
        ...(!previous ? { description: excerpt } : {}),
        source: {
          scene_id: scene.id,
          revision: saved.revision,
          excerpt,
          start: range.start,
          end: range.end,
        },
      };
      if (onPrepareShot && (!previous || !shot.video_node_id)) {
        if (
          JSON.stringify(pendingShot.current?.source) ===
          JSON.stringify(shot.source)
        )
          shot = pendingShot.current!;
        else pendingShot.current = shot;
        shot = await onPrepareShot(shot);
        pendingShot.current = shot;
      }
      await beforeStoryboardSave?.();
      const updated = await saveStoryboard(project, {
        ...latest,
        shots: previous
          ? latest.shots.map((item) => (item.id === shot.id ? shot : item))
          : [...latest.shots, shot],
      });
      client.setQueryData(keys.storyboard(project), updated);
      pendingShot.current = undefined;
      onStoryboard?.(shot.id);
    });
  }

  return (
    <section
      ref={workspace}
      className="visual-previs-library visual-script"
      aria-label="分集剧本"
    >
      {renderHeader?.(busy, (action) => commit(action), Boolean(draft))}
      <div className="visual-previs-layout script-linked-layout">
        <WorkspaceSidebar label="剧本" icon={FileText}>
          <aside className="visual-previs-scenes" aria-label="集与分镜">
            <ScriptDirectory
              episodes={current?.episodes ?? []}
              selectedEpisode={episode?.id}
              selectedScene={scene?.id}
              targetScene={initialSceneId}
              busy={busy || !current}
              readOnly={readOnly}
              onDelete={(episode, scene) => setDeleting({ episode, scene })}
              onSelect={(episode, scene) => {
                setEpisodeId(episode);
                setSceneId(scene ?? "");
                setOverview(!scene);
              }}
              onNewEpisode={() => {
                if (!current) return;
                const id = crypto.randomUUID();
                updateEpisodes([
                  ...current.episodes,
                  {
                    id,
                    title: `第 ${current.episodes.length + 1} 集`,
                    scenes: [],
                  },
                ]);
                setEpisodeId(id);
                setSceneId("");
                setOverview(true);
                return id;
              }}
              onNewScene={(ownerId) => {
                if (!current) return;
                const owner = current.episodes.find(
                  (item) => item.id === ownerId,
                );
                if (!owner) return;
                const id = crypto.randomUUID();
                updateEpisodes(
                  current.episodes.map((item) =>
                    item.id === ownerId
                      ? {
                          ...item,
                          scenes: [
                            ...item.scenes,
                            {
                              id,
                              title: `分镜 ${String(item.scenes.length + 1).padStart(2, "0")}`,
                              ...exampleScene,
                            },
                          ],
                        }
                      : item,
                  ),
                );
                setEpisodeId(ownerId);
                setSceneId(id);
                setOverview(false);
              }}
            />
          </aside>
        </WorkspaceSidebar>
        <div className="creative-window">
          <header className="creative-toolbar script-document-toolbar">
            <button
              className="creative-quiet"
              aria-expanded={linksOpen}
              onClick={() => setLinksOpen(!linksOpen)}
            >
              <Clapperboard size={16} />
              关联分镜 {related.length}
            </button>
            <span className="script-document-context">
              {episode?.scenes.length ?? 0} 镜
            </span>
            {!readOnly && (
              <div className="script-document-actions">
                <button
                  aria-label="保存剧本"
                  title="保存剧本"
                  className="creative-primary"
                  disabled={!draft || busy}
                  onClick={() => commit()}
                >
                  <Save size={14} aria-hidden />
                  <span>保存剧本</span>
                </button>
                {scene && (
                  <button
                    className="creative-quiet"
                    title="提取设定"
                    aria-label="提取设定"
                    disabled={busy || !scene.text.trim()}
                    onClick={() => handoff(setExtract)}
                  >
                    <Shapes size={14} aria-hidden />
                    <span>提取设定</span>
                  </button>
                )}
                {scene && onPrevis && (
                  <button
                    className="creative-quiet"
                    title="转为白模预演"
                    aria-label="转为白模预演"
                    disabled={busy || !scene.text.trim()}
                    onClick={() => handoff(onPrevis)}
                  >
                    <Box size={14} aria-hidden />
                    <span>转为白模预演</span>
                  </button>
                )}
              </div>
            )}
          </header>
          {error && (
            <div className="creative-feedback" role="alert">
              {error}{" "}
              {draft && (
                <button
                  className="creative-quiet"
                  disabled={busy}
                  onClick={() => setReloadOpen(true)}
                >
                  载入服务器版本
                </button>
              )}
            </div>
          )}
          {script.isPending && (
            <p className="creative-feedback" role="status">
              正在读取剧本…
            </p>
          )}
          {script.isError && (
            <p className="creative-feedback" role="alert">
              {apiErrorMessage(script.error)}
            </p>
          )}
          {episode ? (
            <div
              className={`script-page${overview ? " script-episode-page" : ""}`}
            >
              {!readOnly && (
                <div className="script-episode-tools">
                  <label>
                    分集名称{" "}
                    <input
                      aria-label="分集名称"
                      value={episode.title}
                      disabled={busy}
                      maxLength={120}
                      onChange={(event) =>
                        changeEpisode({ title: event.target.value })
                      }
                    />
                  </label>
                  <BoardMenu
                    label="调整本集顺序"
                    triggerIcon={<ArrowUpDown size={14} aria-hidden />}
                    triggerClassName="script-sort-trigger"
                    items={[-1, 1].map((delta) => ({
                      label: delta < 0 ? "上移本集" : "下移本集",
                      icon:
                        delta < 0 ? (
                          <ArrowUp size={14} />
                        ) : (
                          <ArrowDown size={14} />
                        ),
                      disabled:
                        busy ||
                        (current?.episodes.indexOf(episode) ?? 0) + delta < 0 ||
                        (current?.episodes.indexOf(episode) ?? 0) + delta >=
                          (current?.episodes.length ?? 0),
                      onSelect: () =>
                        current &&
                        updateEpisodes(
                          move(
                            current.episodes,
                            (item) => item.id,
                            episode.id,
                            delta,
                          ),
                        ),
                    }))}
                  />
                </div>
              )}
              {overview && episode.scenes.length > 0 ? (
                <ScriptEpisodeOverview
                  key={episode.id}
                  episode={episode}
                  shots={board.data?.shots ?? []}
                  nodes={nodes}
                  busy={busy}
                  readOnly={readOnly}
                  onOrder={(scenes) => changeEpisode({ scenes })}
                  onEdit={(id) => {
                    setSceneId(id);
                    setOverview(false);
                  }}
                  onProduction={
                    onStoryboard
                      ? (id) => commit(() => onStoryboard(id))
                      : undefined
                  }
                />
              ) : scene ? (
                <>
                  {readOnly ? (
                    <h2>{scene.title}</h2>
                  ) : (
                    <div className="script-title-line">
                      <span className="script-field-label">分镜名称</span>
                      <input
                        className="script-title"
                        aria-label="分镜名称"
                        value={scene.title}
                        disabled={busy}
                        maxLength={120}
                        onChange={(event) =>
                          changeScene({ title: event.target.value })
                        }
                      />
                      <BoardMenu
                        label="调整本分镜顺序"
                        triggerIcon={<ArrowUpDown size={14} aria-hidden />}
                        triggerClassName="script-sort-trigger"
                        items={[-1, 1].map((delta) => ({
                          label: delta < 0 ? "上移本分镜" : "下移本分镜",
                          icon:
                            delta < 0 ? (
                              <ArrowUp size={14} />
                            ) : (
                              <ArrowDown size={14} />
                            ),
                          disabled:
                            busy ||
                            episode.scenes.indexOf(scene) + delta < 0 ||
                            episode.scenes.indexOf(scene) + delta >=
                              episode.scenes.length,
                          onSelect: () =>
                            changeEpisode({
                              scenes: move(
                                episode.scenes,
                                (item) => item.id,
                                scene.id,
                                delta,
                              ),
                            }),
                        }))}
                      />
                    </div>
                  )}
                  {readOnly ? (
                    <p>{scene.heading}</p>
                  ) : (
                    <input
                      className="script-location"
                      aria-label="场景信息"
                      placeholder="室内 · 咖啡馆 · 夜"
                      value={scene.heading ?? ""}
                      disabled={busy}
                      maxLength={240}
                      onChange={(event) =>
                        changeScene({ heading: event.target.value })
                      }
                    />
                  )}
                  <div className="script-body-heading">
                    <span>分镜正文</span>
                    <small>
                      {scene.text.length.toLocaleString()} / 12,000 字
                    </small>
                  </div>
                  {readOnly ? (
                    <div className="script-readonly">{scene.text}</div>
                  ) : (
                    <textarea
                      ref={textInput}
                      onSelect={(event) =>
                        captureSelection(event.currentTarget)
                      }
                      onKeyUp={(event) => captureSelection(event.currentTarget)}
                      onMouseUp={(event) =>
                        captureSelection(event.currentTarget)
                      }
                      className="script-text"
                      aria-label="剧本文本"
                      placeholder="写下这个分镜的画面、运镜、动作、对白和声音。"
                      value={scene.text ?? ""}
                      disabled={busy}
                      maxLength={12000}
                      onChange={(event) =>
                        changeScene({ text: event.target.value })
                      }
                    />
                  )}
                </>
              ) : (
                <p>本集还没有分镜。</p>
              )}
            </div>
          ) : (
            current && <p className="creative-feedback">这个项目还没有剧本。</p>
          )}
        </div>
        <aside
          className="script-linked-shots"
          aria-label="剧本关联镜头"
          hidden={!linksOpen}
          onKeyDown={(event) => {
            if (event.key === "Escape") setLinksOpen(false);
          }}
        >
          <header className="script-linked-heading">
            <h2>
              <Clapperboard size={16} aria-hidden />
              关联分镜 <small>{related.length}</small>
            </h2>
            <button
              className="creative-quiet script-linked-close"
              aria-label="关闭关联分镜"
              onClick={() => setLinksOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          {!readOnly && !overview && (
            <section
              className="script-link-selection"
              aria-label="选段关联镜头"
            >
              <h3>选段关联镜头</h3>
              <blockquote className={range ? "has-selection" : ""}>
                {(range && scene?.text.slice(range.start, range.end)) ||
                  (scene
                    ? "在正文中选中动作或对白"
                    : "先选择分镜，再在正文中选取片段")}
              </blockquote>
              <CustomSelect
                ariaLabel="选段关联目标"
                value={target}
                onChange={setTarget}
                options={[
                  { value: "", label: "新建镜头" },
                  ...(board.data?.shots ?? []).map((shot) => ({
                    value: shot.id,
                    label: shot.title,
                  })),
                ]}
              />
              <button
                className="creative-primary script-link-submit"
                disabled={
                  busy || !range || range.end <= range.start || !board.data
                }
                onClick={linkSelection}
              >
                {target ? "关联到镜头" : "从选段新建镜头"}
              </button>
            </section>
          )}
          {board.isError && (
            <p role="alert">
              关联分镜读取失败
              <button onClick={() => void board.refetch()}>重试</button>
            </p>
          )}
          <div className="script-linked-list">
            {related.map((shot) => (
              <article key={shot.id}>
                <button
                  aria-label={shot.title}
                  onClick={() => commit(() => onStoryboard?.(shot.id))}
                >
                  <span className="script-linked-number">
                    {String(
                      (board.data?.shots.indexOf(shot) ?? 0) + 1,
                    ).padStart(2, "0")}
                  </span>
                  <span className="script-linked-copy">
                    <strong>{shot.title}</strong>
                    <span>
                      {shot.source?.excerpt ||
                        shot.description ||
                        "已关联本分镜"}
                    </span>
                  </span>
                  <ChevronRight size={14} aria-hidden />
                </button>
                {shot.source?.excerpt &&
                  scene &&
                  !locateExcerpt(scene.text, shot.source) && (
                    <small>原文已变化，保留了关联时的选段</small>
                  )}
              </article>
            ))}
            {!related.length && !board.isError && (
              <p className="script-linked-empty">
                {scene
                  ? "本分镜还没有关联分镜"
                  : overview
                    ? "本集还没有关联制作"
                    : "选择分镜后查看关联分镜"}
              </p>
            )}
          </div>
        </aside>
      </div>
      <ConfirmDialog
        open={Boolean(deleteEpisode)}
        title={`删除${deleting?.scene ? "分镜" : "整集"}“${deleteScene?.title ?? deleteEpisode?.title ?? ""}”？`}
        description={
          <>
            {!deleting?.scene && (
              <p>
                将删除本集及其全部 {deleteEpisode?.scenes.length ?? 0} 个分镜。
              </p>
            )}
            <p>
              确认后从当前草稿移除，保存剧本后生效。已关联的分镜和素材会保留。
            </p>
          </>
        }
        confirmLabel="删除"
        confirmDisabled={busy || readOnly}
        onCancel={() => setDeleting(undefined)}
        onConfirm={deleteEntry}
      />
      <ConfirmDialog
        open={reloadOpen}
        title="载入服务器版本？"
        description="载入服务器版本会舍弃当前草稿。"
        confirmLabel="载入"
        pending={busy}
        onCancel={() => setReloadOpen(false)}
        onConfirm={async () => {
          if (flight.current) return;
          flight.current = true;
          setBusy(true);
          try {
            const result = await script.refetch();
            if (result.isSuccess) {
              setDraft(undefined);
              setSelection(undefined);
              setError("");
              setReloadOpen(false);
            } else setError(apiErrorMessage(result.error));
          } finally {
            flight.current = false;
            setBusy(false);
          }
        }}
      />
      {extract && (
        <ScriptCardExtraction
          project={project}
          seed={extract}
          onClose={() => setExtract(undefined)}
        />
      )}
    </section>
  );
}
