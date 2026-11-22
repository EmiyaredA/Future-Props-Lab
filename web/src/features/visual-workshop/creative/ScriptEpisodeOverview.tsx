import { useRef } from "react";
import { ArrowDown, ArrowUp, Clapperboard, GripVertical } from "lucide-react";
import type { Script } from "./api";
import type { Shot } from "../storyboard/api";
import type { VisualCanvasNode } from "../api";
import { OutputPreview } from "../board/OutputPreview";
import "./script-episode.css";

type Episode = Script["episodes"][number];

export function ScriptEpisodeOverview({
  episode,
  shots,
  nodes,
  busy,
  readOnly,
  onOrder,
  onEdit,
  onProduction,
}: {
  episode: Episode;
  shots: Shot[];
  nodes: VisualCanvasNode[];
  busy: boolean;
  readOnly: boolean;
  onOrder: (scenes: Episode["scenes"]) => void;
  onEdit: (id: string) => void;
  onProduction?: (id: string) => void;
}) {
  const dragging = useRef("");
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const byScene = new Map<string, Shot[]>();
  for (const shot of shots) {
    if (!shot.source) continue;
    const group = byScene.get(shot.source.scene_id) ?? [];
    group.push(shot);
    byScene.set(shot.source.scene_id, group);
  }
  function reorder(fromId: string, toId: string) {
    if (busy || readOnly) return;
    const from = episode.scenes.findIndex((scene) => scene.id === fromId);
    const to = episode.scenes.findIndex((scene) => scene.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const scenes = [...episode.scenes];
    scenes.splice(to, 0, scenes.splice(from, 1)[0]);
    onOrder(scenes);
  }
  return (
    <section className="script-episode-overview" aria-label="整集分镜">
      <header className="script-episode-heading">
        <h2>{episode.title}</h2>
        <span>{episode.scenes.length} 个分镜 · 按顺序串联</span>
        {!readOnly && <small>拖动或上下移动分镜，保存剧本后保留顺序。</small>}
      </header>
      <ol className="script-episode-sequence" aria-label="本集分镜顺序">
        {episode.scenes.map((scene, index) => {
          const linked = byScene.get(scene.id) ?? [];
          const media = linked.flatMap((shot) => {
            const video = nodeById.get(shot.video_node_id ?? "");
            const image = nodeById.get(shot.image_node_id ?? "");
            const node =
              video?.kind === "video" && video.asset_id
                ? video
                : image?.kind === "image" && image.asset_id
                  ? image
                  : undefined;
            return node ? [{ node, shot }] : [];
          });
          return (
            <li
              key={scene.id}
              className="script-episode-block"
              onDragOver={(event) => {
                if (!busy && !readOnly && dragging.current)
                  event.preventDefault();
              }}
              onDrop={(event) => {
                if (!dragging.current) return;
                event.preventDefault();
                reorder(dragging.current, scene.id);
                dragging.current = "";
              }}
            >
              <div className="script-episode-block-toolbar">
                <span className="script-episode-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {!readOnly && (
                  <div>
                    <button
                      type="button"
                      aria-label={`拖动排序 ${scene.title}`}
                      disabled={busy}
                      draggable={!busy}
                      onDragStart={(event) => {
                        if (busy) {
                          event.preventDefault();
                          return;
                        }
                        dragging.current = scene.id;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", scene.id);
                      }}
                      onDragEnd={() => {
                        dragging.current = "";
                      }}
                    >
                      <GripVertical size={15} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`上移分镜 ${scene.title}`}
                      disabled={busy || index === 0}
                      onClick={() =>
                        reorder(scene.id, episode.scenes[index - 1].id)
                      }
                    >
                      <ArrowUp size={15} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`下移分镜 ${scene.title}`}
                      disabled={busy || index === episode.scenes.length - 1}
                      onClick={() =>
                        reorder(scene.id, episode.scenes[index + 1].id)
                      }
                    >
                      <ArrowDown size={15} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
              <div className="script-episode-thumbnail">
                {media[0] ? (
                  <OutputPreview
                    kind={media[0].node.kind}
                    assetId={media[0].node.asset_id}
                    compact
                  />
                ) : (
                  <Clapperboard size={32} aria-hidden />
                )}
              </div>
              <div className="script-episode-block-copy">
                <h3>{scene.title}</h3>
                {scene.heading && <small>{scene.heading}</small>}
                <p>{scene.text || "尚未填写分镜内容"}</p>
              </div>
              <footer>
                <button
                  className="creative-quiet"
                  disabled={busy}
                  onClick={() => onEdit(scene.id)}
                >
                  {readOnly ? "查看剧本" : "编辑分镜"}
                </button>
                <span>
                  {media.length
                    ? `${media.length} 项已有画面`
                    : linked.length
                      ? "等待制作输出"
                      : "尚未关联制作"}
                </span>
              </footer>
              {linked.length > 0 && (
                <div className="script-episode-productions">
                  {linked.map((shot) => (
                    <button
                      key={shot.id}
                      className="creative-quiet"
                      disabled={busy || !onProduction}
                      onClick={() => onProduction?.(shot.id)}
                      aria-label={`查看制作 ${shot.title}`}
                    >
                      <Clapperboard size={14} aria-hidden />
                      <span>{shot.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
