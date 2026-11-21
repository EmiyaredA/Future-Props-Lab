import { ScriptDirectory } from "./ScriptDirectory";
import { WorkspaceSidebar } from "../WorkspaceSidebar";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Clapperboard, FileText, X } from "lucide-react";
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
  readOnly = false,
  activeWorkspace = true,
  renderHeader,
  onPrevis,
  initialSceneId,
  initialSource,
  onStoryboard,
}: {
  project: string;
  initialSceneId?: string;
  initialSource?: Shot["source"];
  onStoryboard?: (id?: string) => void;
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
  const [selection, setSelection] = useState<{
    scene: string;
    start: number;
    end: number;
  }>();
  const [linksOpen, setLinksOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [draft, setDraft] = useState<Script>();
  const current = draft ?? script.data;
  const [episodeId, setEpisodeId] = useState("");
  const [sceneId, setSceneId] = useState(initialSceneId ?? "");
  useEffect(() => {
    if (initialSceneId) {
      setSceneId(initialSceneId);
      setEpisodeId("");
    }
  }, [initialSceneId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extract, setExtract] = useState<ScriptSeed>();
  const flight = useRef(false);
  const leaving = useRef(false);
  const episode =
    current?.episodes.find((item) => item.id === episodeId) ??
    current?.episodes.find((item) =>
      item.scenes.some((scene) => scene.id === sceneId),
    ) ??
    current?.episodes[0];
  const scene =
    episode?.scenes.find((item) => item.id === sceneId) ?? episode?.scenes[0];

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

  const related =
    board.data?.shots.filter((shot) => shot.source?.scene_id === scene?.id) ??
    [];
  const range = selection?.scene === scene?.id ? selection : undefined;
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
      const shot = {
        ...(previous ?? emptyShot(excerpt.slice(0, 32))),
        source: {
          scene_id: scene.id,
          revision: saved.revision,
          excerpt,
          start: range.start,
          end: range.end,
        },
      };
      const updated = await saveStoryboard(project, {
        ...latest,
        shots: previous
          ? latest.shots.map((item) => (item.id === shot.id ? shot : item))
          : [...latest.shots, shot],
      });
      client.setQueryData(keys.storyboard(project), updated);
      onStoryboard?.(shot.id);
    });
  }

  return (
    <section
      className="visual-previs-library visual-script"
      aria-label="分集剧本"
    >
      {renderHeader?.(busy, (action) => commit(action), Boolean(draft))}
      <div className="visual-previs-layout script-linked-layout">
        <WorkspaceSidebar label="剧本" icon={FileText}>
          <aside className="visual-previs-scenes" aria-label="集与场">
            <ScriptDirectory
              episodes={current?.episodes ?? []}
              selectedEpisode={episode?.id}
              selectedScene={scene?.id}
              targetScene={initialSceneId}
              busy={busy || !current}
              readOnly={readOnly}
              onSelect={(episode, scene) => {
                setEpisodeId(episode);
                setSceneId(scene ?? "");
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
                              title: `第 ${item.scenes.length + 1} 场`,
                              heading: "",
                              text: "",
                            },
                          ],
                        }
                      : item,
                  ),
                );
                setEpisodeId(ownerId);
                setSceneId(id);
              }}
            />
          </aside>
        </WorkspaceSidebar>
        <div className="creative-window">
          <header className="creative-toolbar">
            <button
              className="creative-quiet"
              aria-expanded={linksOpen}
              onClick={() => setLinksOpen(!linksOpen)}
            >
              <Clapperboard size={16} />
              关联分镜 {related.length}
            </button>
            <strong>
              {episode?.title ?? "分集剧本"}
              {scene ? ` / ${scene.title}` : ""}
            </strong>
            {!readOnly && (
              <div>
                <button
                  className="creative-primary"
                  disabled={!draft || busy}
                  onClick={() => commit()}
                >
                  保存剧本
                </button>
                {scene && (
                  <button
                    className="creative-quiet"
                    disabled={busy || !scene.text.trim()}
                    onClick={() => handoff(setExtract)}
                  >
                    提取设定
                  </button>
                )}
                {scene && onPrevis && (
                  <button
                    className="creative-quiet"
                    disabled={busy || !scene.text.trim()}
                    onClick={() => handoff(onPrevis)}
                  >
                    转为白模预演
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
                  onClick={async () => {
                    if (
                      window.confirm("载入服务器版本会舍弃当前草稿，是否继续？")
                    ) {
                      const result = await script.refetch();
                      if (result.isSuccess) {
                        setDraft(undefined);
                        setError("");
                      }
                    }
                  }}
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
            <div className="script-page">
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
                  <details className="script-sort">
                    <summary>调整顺序</summary>
                    {[-1, 1].map((delta) => (
                      <button
                        key={delta}
                        className="creative-quiet"
                        type="button"
                        disabled={
                          busy ||
                          (current?.episodes.indexOf(episode) ?? 0) + delta <
                            0 ||
                          (current?.episodes.indexOf(episode) ?? 0) + delta >=
                            (current?.episodes.length ?? 0)
                        }
                        aria-label={delta < 0 ? "上移本集" : "下移本集"}
                        onClick={() =>
                          current &&
                          updateEpisodes(
                            move(
                              current.episodes,
                              (item) => item.id,
                              episode.id,
                              delta,
                            ),
                          )
                        }
                      >
                        {delta < 0 ? (
                          <ArrowUp size={15} />
                        ) : (
                          <ArrowDown size={15} />
                        )}
                      </button>
                    ))}
                  </details>
                </div>
              )}
              {scene ? (
                <>
                  {readOnly ? (
                    <h2>{scene.title}</h2>
                  ) : (
                    <div className="script-title-line">
                      <input
                        className="script-title"
                        aria-label="场次名称"
                        value={scene.title}
                        disabled={busy}
                        maxLength={120}
                        onChange={(event) =>
                          changeScene({ title: event.target.value })
                        }
                      />
                      <details className="script-sort">
                        <summary>调整顺序</summary>
                        {[-1, 1].map((delta) => (
                          <button
                            key={delta}
                            className="creative-quiet"
                            type="button"
                            disabled={
                              busy ||
                              episode.scenes.indexOf(scene) + delta < 0 ||
                              episode.scenes.indexOf(scene) + delta >=
                                episode.scenes.length
                            }
                            aria-label={delta < 0 ? "上移本场" : "下移本场"}
                            onClick={() =>
                              changeEpisode({
                                scenes: move(
                                  episode.scenes,
                                  (item) => item.id,
                                  scene.id,
                                  delta,
                                ),
                              })
                            }
                          >
                            {delta < 0 ? (
                              <ArrowUp size={15} />
                            ) : (
                              <ArrowDown size={15} />
                            )}
                          </button>
                        ))}
                      </details>
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
                  {readOnly ? (
                    <div className="script-readonly">{scene.text}</div>
                  ) : (
                    <textarea
                      ref={textInput}
                      onSelect={(event) => {
                        const input = event.currentTarget;
                        if (input.selectionEnd > input.selectionStart)
                          setLinksOpen(true);
                        setSelection({
                          scene: scene.id,
                          start: input.selectionStart,
                          end: input.selectionEnd,
                        });
                      }}
                      className="script-text"
                      aria-label="剧本文本"
                      placeholder="写下场景动作和对白，每位角色的对白另起一行。"
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
                <p>本集还没有场次。</p>
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
          <button
            className="creative-quiet script-linked-close"
            aria-label="关闭关联分镜"
            onClick={() => setLinksOpen(false)}
          >
            <X size={16} />
          </button>
          <h2>
            关联分镜 <small>{related.length}</small>
          </h2>
          {!readOnly && (
            <section>
              <h3>选段关联镜头</h3>
              <blockquote>
                {(range && scene?.text.slice(range.start, range.end)) ||
                  "在正文中选中动作或对白"}
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
                className="creative-primary"
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
          {related.map((shot) => (
            <article key={shot.id}>
              <button onClick={() => commit(() => onStoryboard?.(shot.id))}>
                {shot.title}
              </button>
              <p>{shot.source?.excerpt || shot.description || "已关联本场"}</p>
              {shot.source?.excerpt &&
                scene &&
                !locateExcerpt(scene.text, shot.source) && (
                  <small>原文已变化，保留了关联时的选段</small>
                )}
            </article>
          ))}
        </aside>
      </div>
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
