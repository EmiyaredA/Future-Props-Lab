import type { FastPreviewStageActorEditor } from "@features/galgame-workshop/editor/fastPreviewStageActors";

export function FastPreviewStageActorList({
  actors,
  selectedActorId,
  onSelect,
}: {
  actors: FastPreviewStageActorEditor[];
  selectedActorId?: string;
  onSelect: (actor: FastPreviewStageActorEditor) => void;
}) {
  return (
    <div className="galgame-fast-preview-actor-list">
      {actors.map((actor) => {
        const ability =
          actor.source?.kind === "dialogue"
            ? "对白 / 表情"
            : actor.source
              ? "表情"
              : "仅预览";
        return (
          <button
            key={actor.characterId}
            type="button"
            className={
              selectedActorId === actor.characterId ? "is-selected" : ""
            }
            aria-pressed={selectedActorId === actor.characterId}
            disabled={!actor.source}
            title={
              actor.source?.kind === "dialogue"
                ? `编辑 ${actor.name} 的舞台表现`
                : actor.source
                  ? `编辑 ${actor.name} 的立绘表情`
                  : `${actor.name} 缺少可写回的对白或舞台指令`
            }
            onClick={() => onSelect(actor)}
          >
            <i aria-hidden>{actor.name.slice(0, 1)}</i>
            <span>
              <strong>{actor.name}</strong>
              <small>{actor.expressionLabel}</small>
            </span>
            <em>{ability}</em>
          </button>
        );
      })}
    </div>
  );
}
