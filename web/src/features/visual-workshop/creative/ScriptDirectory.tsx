import {
  ChevronDown,
  ChevronRight,
  Clapperboard,
  FileText,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Script } from "./api";

/** Expansion is a presentation preference; it never changes the editing target. */
export function ScriptDirectory({
  episodes,
  selectedEpisode,
  selectedScene,
  targetScene,
  busy,
  readOnly,
  onSelect,
  onNewEpisode,
  onNewScene,
  onDelete,
}: {
  episodes: Script["episodes"];
  selectedEpisode?: string;
  selectedScene?: string;
  targetScene?: string;
  busy: boolean;
  readOnly: boolean;
  onSelect: (episode: string, scene?: string) => void;
  onNewEpisode: () => string | undefined;
  onNewScene: (episode: string) => void;
  onDelete: (episode: string, scene?: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const initialized = useRef(false);
  const revealedTarget = useRef<string | undefined>(undefined);
  const directory = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initialized.current || !selectedEpisode) return;
    initialized.current = true;
    setExpanded(new Set([selectedEpisode]));
  }, [selectedEpisode]);
  useEffect(() => {
    if (!targetScene || revealedTarget.current === targetScene) return;
    const owner = episodes.find((episode) =>
      episode.scenes.some((scene) => scene.id === targetScene),
    );
    if (owner) {
      revealedTarget.current = targetScene;
      setExpanded((previous) => new Set(previous).add(owner.id));
      setSearch("");
      requestAnimationFrame(() => {
        const target = Array.from(
          directory.current?.querySelectorAll<HTMLButtonElement>(
            "button[data-scene]",
          ) ?? [],
        ).find((button) => button.dataset.scene === targetScene);
        target?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [targetScene, episodes]);
  const query = search.trim().toLocaleLowerCase();
  const visible = episodes.flatMap((episode) => {
    const scenes =
      !query || episode.title.toLocaleLowerCase().includes(query)
        ? episode.scenes
        : episode.scenes.filter((scene) =>
            `${scene.title} ${scene.heading ?? ""}`
              .toLocaleLowerCase()
              .includes(query),
          );
    return !query ||
      scenes.length ||
      episode.title.toLocaleLowerCase().includes(query)
      ? [{ ...episode, scenes }]
      : [];
  });
  return (
    <>
      <label className="workspace-search">
        <Search size={16} aria-hidden />
        <input
          aria-label="搜索集与场次"
          placeholder="搜索集与场次…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="visual-previs-scenes-heading">
        <h1>分集目录</h1>
        {!readOnly && (
          <button
            className="creative-quiet"
            disabled={busy}
            onClick={() => {
              const id = onNewEpisode();
              if (id) {
                setSearch("");
                setExpanded((previous) => new Set(previous).add(id));
              }
            }}
          >
            <Plus size={16} />
            新建集
          </button>
        )}
      </div>
      <div className="script-directory-list" ref={directory}>
        {!visible.length && (
          <p className="creative-feedback">
            {query ? "没有匹配的集或场次" : "还没有分集剧本"}
          </p>
        )}
        {visible.map((episode) => {
          const open = Boolean(query) || expanded.has(episode.id);
          return (
            <div key={episode.id} className="script-tree-episode">
              <div className="script-tree-episode-heading">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? "收起" : "展开"}${episode.title}`}
                  onClick={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(episode.id)) next.delete(episode.id);
                      else next.add(episode.id);
                      return next;
                    })
                  }
                >
                  {open ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
                <button
                  type="button"
                  className="script-tree-select"
                  disabled={busy}
                  aria-label={`编辑${episode.title}`}
                  onClick={() => onSelect(episode.id)}
                >
                  <Clapperboard size={16} />
                  <span>{episode.title}</span>
                  <small>{episode.scenes.length} 场</small>
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    className="script-tree-delete"
                    disabled={busy}
                    aria-label={`删除整集 ${episode.title}`}
                    title="删除整集"
                    onClick={() => onDelete(episode.id)}
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                )}
              </div>
              {open && (
                <ul className="script-tree-scenes">
                  {episode.scenes.map((scene) => (
                    <li key={scene.id} className="script-tree-scene-row">
                      <button
                        type="button"
                        className="script-tree-select"
                        aria-current={
                          selectedScene === scene.id &&
                          selectedEpisode === episode.id
                            ? "true"
                            : undefined
                        }
                        disabled={busy}
                        data-scene={scene.id}
                        onClick={() => onSelect(episode.id, scene.id)}
                      >
                        <FileText size={15} />
                        <span>{scene.title}</span>
                      </button>
                      {!readOnly && (
                        <button
                          type="button"
                          className="script-tree-delete"
                          disabled={busy}
                          aria-label={`删除场次 ${scene.title}`}
                          title="删除场次"
                          onClick={() => onDelete(episode.id, scene.id)}
                        >
                          <Trash2 size={15} aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
                  {!readOnly && (
                    <li>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onNewScene(episode.id)}
                      >
                        <Plus size={15} />
                        新建场
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <footer className="script-directory-footer">
        <small>
          已展开 {episodes.filter((episode) => expanded.has(episode.id)).length}{" "}
          集
        </small>
        <button
          type="button"
          disabled={Boolean(query)}
          onClick={() => setExpanded(new Set())}
        >
          全部收起
        </button>
      </footer>
    </>
  );
}
