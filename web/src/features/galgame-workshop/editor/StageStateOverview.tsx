import { UserRound } from "lucide-react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { characterExpressionAssetId } from "@features/galgame-workshop/editor/richText";
import {
  visibleStageActors,
  type GalgameStageState,
} from "@features/galgame-workshop/editor/stage";

const POSITION_LABELS: Record<string, string> = {
  left: "左",
  center: "中",
  right: "右",
};

export function StageStateOverview({
  document,
  state,
}: {
  document: GalgameStoryProject;
  state?: GalgameStageState;
}) {
  const actors = state ? visibleStageActors(state) : [];
  return (
    <aside
      className="galgame-stage-state-overview"
      aria-label="当前舞台，此卡执行后"
    >
      <header>
        <strong>当前舞台 · 此卡执行后</strong>
        <span>舞台角色 {actors.length}</span>
      </header>
      <div className="galgame-stage-state-actors">
        {actors.map((actor) => {
          const character = document.characters?.find(
            (candidate) => candidate.id === actor.characterId,
          );
          const assetId = characterExpressionAssetId(
            character,
            actor.expressionId,
            actor.skinId,
          );
          const asset = document.assets?.find((item) => item.id === assetId);
          const expression = character?.expressions?.find(
            (item) => item.id === actor.expressionId,
          );
          const speaking = state?.activeSpeakerIds?.includes(actor.characterId);
          return (
            <article
              className={speaking ? "is-speaking" : ""}
              key={actor.characterId}
            >
              <StoryAssetImage
                fileId={asset?.fileId}
                alt=""
                fallback={<UserRound aria-hidden />}
              />
              <span>
                <strong>{character?.name ?? "未知角色"}</strong>
                <small>
                  {POSITION_LABELS[actor.positionId ?? ""] ??
                    actor.positionId ??
                    "自定义"}
                  {" · "}
                  {expression?.label ?? "默认表情"}
                </small>
                <small>
                  {actor.distance === "near"
                    ? "近景"
                    : actor.distance === "far"
                      ? "远景"
                      : "中景"}
                </small>
              </span>
              <em>{speaking ? "发言中" : "在场"}</em>
            </article>
          );
        })}
        {!actors.length ? <p>此时舞台上没有角色</p> : null}
      </div>
    </aside>
  );
}
