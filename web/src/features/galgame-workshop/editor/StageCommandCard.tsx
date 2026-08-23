import { ArrowRight, LogIn, LogOut, Users } from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  visibleStageActors,
  type GalgameStageState,
} from "@features/galgame-workshop/editor/stage";

type StageCommandBlock = Extract<
  GalgameStoryBlock,
  { type: "setStageCast" | "showCharacter" | "removeCharacter" }
>;

const POSITION_LABELS: Record<string, string> = {
  left: "左侧",
  center: "中央",
  right: "右侧",
};

export function StageCommandCard({
  block,
  index,
  selected,
  document,
  before,
  after,
  onSelect,
}: {
  block: StageCommandBlock;
  index: number;
  selected: boolean;
  document: GalgameStoryProject;
  before?: GalgameStageState;
  after?: GalgameStageState;
  onSelect: () => void;
}) {
  const beforeIds = new Set(
    visibleStageActors(before ?? { actors: {} }).map(
      (actor) => actor.characterId,
    ),
  );
  const actors = visibleStageActors(after ?? { actors: {} });
  const afterIds = new Set(actors.map((actor) => actor.characterId));
  const added = actors.filter((actor) => !beforeIds.has(actor.characterId));
  const removed = [...beforeIds].filter((id) => !afterIds.has(id));
  const Icon =
    block.type === "removeCharacter"
      ? LogOut
      : block.type === "showCharacter"
        ? LogIn
        : Users;
  const label =
    block.type === "setStageCast"
      ? "舞台构图"
      : block.type === "showCharacter"
        ? "角色登场"
        : "角色退场";
  const characterName = (id: string) =>
    document.characters?.find((character) => character.id === id)?.name ??
    "未知角色";
  return (
    <article
      className={`galgame-block-card galgame-stage-command-card is-${block.type}${selected ? " selected" : ""}`}
      data-block-id={block.id}
      tabIndex={0}
      onFocusCapture={onSelect}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <button
        type="button"
        className="galgame-block-select"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="galgame-stage-command-icon">
          <Icon aria-hidden />
        </span>
        <span className="galgame-stage-command-copy">
          <strong>{label}</strong>
          <span>
            {actors.map((actor) => (
              <em
                key={actor.characterId}
                className={beforeIds.has(actor.characterId) ? "" : "is-added"}
              >
                {POSITION_LABELS[actor.positionId ?? ""] ??
                  actor.positionId ??
                  "自定义"}{" "}
                · {characterName(actor.characterId)}
              </em>
            ))}
            {!actors.length ? <em>舞台已清空</em> : null}
          </span>
        </span>
        <span className="galgame-stage-command-diff">
          {added.length ? (
            <small className="is-added">
              ＋
              {added
                .map((actor) => characterName(actor.characterId))
                .join("、")}
            </small>
          ) : null}
          {removed.length ? (
            <small className="is-removed">
              －{removed.map(characterName).join("、")}
            </small>
          ) : null}
          {!added.length && !removed.length ? (
            <small>构图参数更新</small>
          ) : null}
          <ArrowRight aria-hidden />
        </span>
      </button>
    </article>
  );
}
