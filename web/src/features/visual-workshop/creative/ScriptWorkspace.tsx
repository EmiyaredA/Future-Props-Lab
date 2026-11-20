import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Clapperboard, FileText, Plus } from "lucide-react";
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
  renderHeader,
  onPrevis,
}: {
  project: string;
  readOnly?: boolean;
  renderHeader?: (busy: boolean, navigate: Navigate) => ReactNode;
  onPrevis?: (seed: ScriptSeed) => void;
}) {
  const client = useQueryClient();
  const key = scriptKey(project);
  const script = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getScript(project, signal),
  });
  const [draft, setDraft] = useState<Script>();
  const current = draft ?? script.data;
  const [episodeId, setEpisodeId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extract, setExtract] = useState<ScriptSeed>();
  const flight = useRef(false);
  const leaving = useRef(false);
  const episode =
    current?.episodes.find((item) => item.id === episodeId) ??
    current?.episodes[0];
  const scene =
    episode?.scenes.find((item) => item.id === sceneId) ?? episode?.scenes[0];

  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

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

  return (
    <section
      className="visual-previs-library visual-script"
      aria-label="分集剧本"
    >
      {renderHeader?.(busy, (action) => commit(action))}
      <div className="visual-previs-layout">
        <aside className="visual-previs-scenes" aria-label="集与场">
          <div className="visual-previs-scenes-heading">
            <h1>分集剧本</h1>
            {!readOnly && (
              <button
                type="button"
                className="creative-quiet"
                disabled={!current || busy}
                onClick={() => {
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
                }}
              >
                <Plus size={15} /> 新建集
              </button>
            )}
          </div>
          {current?.episodes.map((item) => (
            <div key={item.id} className="script-tree-episode">
              <button
                type="button"
                aria-expanded={episode?.id === item.id}
                onClick={() => {
                  setEpisodeId(item.id);
                  setSceneId("");
                }}
              >
                <Clapperboard size={15} /> {item.title}
              </button>
              {episode?.id === item.id && (
                <ul className="script-tree-scenes">
                  {item.scenes.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        aria-current={
                          scene?.id === entry.id ? "true" : undefined
                        }
                        onClick={() => setSceneId(entry.id)}
                      >
                        <FileText size={14} /> {entry.title}
                      </button>
                    </li>
                  ))}
                  {!readOnly && (
                    <li>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const id = crypto.randomUUID();
                          changeEpisode({
                            scenes: [
                              ...item.scenes,
                              {
                                id,
                                title: `第 ${item.scenes.length + 1} 场`,
                                heading: "",
                                text: "",
                              },
                            ],
                          });
                          setSceneId(id);
                        }}
                      >
                        <Plus size={15} /> 新建场
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </aside>
        <div className="creative-window">
          <header className="creative-toolbar">
            <strong>
              {episode?.title ?? "分集剧本"}
              {scene ? ` / ${scene.title}` : ""}
            </strong>
            {!readOnly && (
              <div>
                <button
                  className="creative-quiet"
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
                    className="creative-primary"
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
                  {[-1, 1].map((delta) => (
                    <button
                      key={delta}
                      className="creative-quiet"
                      type="button"
                      disabled={
                        busy ||
                        (current?.episodes.indexOf(episode) ?? 0) + delta < 0 ||
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
