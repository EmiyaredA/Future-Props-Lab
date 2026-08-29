import { ArrowDown, ArrowUp, Clock3, Settings2, Trash2 } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  stableId,
  updateFragment,
} from "@features/galgame-workshop/editor/model";
import {
  attachTimelineCharacterEvent,
  formatTimecode,
  resizeTimelineCueEnd,
  setTimelineCgRangeEdge,
  setTimelineCueEdge,
  setTimelinePointTime,
} from "@features/galgame-workshop/editor/timeline";
import "@features/galgame-workshop/galgameStyles";
import { BlockInspectorFields } from "@features/galgame-workshop/editor/story-authoring/inspectors/BlockInspectorFields";
import type { BlockInspectorControllerModel } from "@features/galgame-workshop/editor/story-authoring/inspectors/types";
import {
  BLOCK_LABELS,
  BlockTypeIcon,
  Field,
  TimecodeField,
} from "@features/galgame-workshop/editor/InspectorFieldControls";
export {
  Field,
  ChapterCast,
  FragmentOverviewInspector,
} from "@features/galgame-workshop/editor/InspectorFieldControls";
export type { BlockInspectorViewModel } from "@features/galgame-workshop/editor/story-authoring/inspectors/types";

export function BlockInspectorView({
  model,
}: {
  model: BlockInspectorControllerModel;
}) {
  if (model.status === "empty")
    return (
      <div className="galgame-inspector-empty">
        <Settings2 aria-hidden />
        <strong>未选择 Block</strong>
        <span>在中间的剧本流中选择一个 Block 后编辑属性。</span>
      </div>
    );
  const {
    block,
    document,
    fragmentId,
    onDocument,
    timelinePreferences,
    onMoveUp,
    onMoveDown,
    onDelete,
    canMoveUp,
    canMoveDown,
    fragment,
    pointTime,
    cgRange,
    characterTiming,
    dialogueTargets,
    dialogueName,
  } = model;
  return (
    <div className="galgame-block-inspector">
      <header>
        <span className={`galgame-block-kind is-${block.type}`}>
          <BlockTypeIcon type={block.type} />
        </span>
        <span>
          <strong>
            {block.type === "dialogue"
              ? `对白 · ${dialogueName}`
              : BLOCK_LABELS[block.type]}
          </strong>
          {block.type === "dialogue" ? null : <small>{block.id}</small>}
        </span>
        <nav className="galgame-block-order-actions" aria-label="执行顺序">
          <button
            type="button"
            disabled={!canMoveUp}
            onClick={onMoveUp}
            aria-label="提前执行"
          >
            <ArrowUp aria-hidden />
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            aria-label="延后执行"
          >
            <ArrowDown aria-hidden />
          </button>
          <button
            type="button"
            className="danger"
            onClick={onDelete}
            aria-label="删除事件"
          >
            <Trash2 aria-hidden />
          </button>
        </nav>
      </header>
      {(block.type === "narration" ||
        block.type === "storyParagraph" ||
        block.type === "systemMessage") &&
      block.startMs != null &&
      block.endMs != null ? (
        <div className="galgame-block-timing" aria-label="对白时间范围">
          <header>
            <Clock3 aria-hidden />
            <span>
              <strong>剧情时间轴</strong>
              <small>时长 {formatTimecode(block.endMs - block.startMs)}</small>
            </span>
          </header>
          <div>
            <TimecodeField
              label="对白开始时间"
              value={block.startMs}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (fragment) =>
                    setTimelineCueEdge(
                      fragment,
                      block.id,
                      "start",
                      milliseconds,
                      true,
                    ),
                  ),
                )
              }
            />
            <TimecodeField
              label="对白结束时间"
              value={block.endMs}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (fragment) =>
                    resizeTimelineCueEnd(fragment, block.id, milliseconds, {
                      precise: true,
                      ripple: timelinePreferences.ripple,
                      keepContinuous: true,
                    }),
                  ),
                )
              }
            />
          </div>
        </div>
      ) : null}
      {block.type === "showCg" && fragment?.timeline && cgRange ? (
        <div className="galgame-block-timing" aria-label="CG 显示时间范围">
          <header>
            <Clock3 aria-hidden />
            <span>
              <strong>CG 显示时间</strong>
              <small>
                时长 {formatTimecode(cgRange.endMs - cgRange.startMs)}
              </small>
            </span>
          </header>
          <div>
            <TimecodeField
              label="CG 开始时间"
              value={cgRange.startMs}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (current) =>
                    setTimelineCgRangeEdge(
                      current,
                      block.id,
                      "start",
                      milliseconds,
                      true,
                    ),
                  ),
                )
              }
            />
            <TimecodeField
              label="CG 结束时间"
              value={cgRange.endMs}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (current) =>
                    setTimelineCgRangeEdge(
                      current,
                      block.id,
                      "end",
                      milliseconds,
                      true,
                      stableId,
                    ),
                  ),
                )
              }
            />
            <TimecodeField
              label="CG 持续时间"
              value={cgRange.endMs - cgRange.startMs}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (current) =>
                    setTimelineCgRangeEdge(
                      current,
                      block.id,
                      "end",
                      cgRange.startMs + milliseconds,
                      true,
                      stableId,
                    ),
                  ),
                )
              }
            />
          </div>
        </div>
      ) : null}
      {(block.type === "showCharacter" ||
        block.type === "setStageCast" ||
        block.type === "removeCharacter") &&
      fragment?.timeline &&
      pointTime != null &&
      characterTiming ? (
        <div className="galgame-block-timing" aria-label="角色演出时间设置">
          <header>
            <Clock3 aria-hidden />
            <span>
              <strong>角色演出时间</strong>
              <small>
                {characterTiming.mode === "independent"
                  ? "独立演出"
                  : characterTiming.mode === "dialogue"
                    ? "跟随对白"
                    : "跟随剧情结尾"}
              </small>
            </span>
          </header>
          <Field label="时间关系">
            <CustomSelect
              ariaLabel="角色演出时间关系"
              value={
                characterTiming.mode === "dialogue"
                  ? `dialogue:${characterTiming.dialogueBlockId}`
                  : characterTiming.mode
              }
              options={[
                { value: "independent", label: "独立时间" },
                ...(characterTiming.mode === "timelineEnd"
                  ? [
                      {
                        value: "timelineEnd",
                        label: "跟随剧情结尾",
                      },
                    ]
                  : []),
                ...dialogueTargets.map((dialogue, index) => {
                  const speaker = (document.characters ?? []).find(
                    (character) => character.id === dialogue.characterId,
                  );
                  const summary = dialogue.text.trim() || "未填写对白";
                  return {
                    value: `dialogue:${dialogue.id}`,
                    label: `跟随对白 ${index + 1} · ${speaker?.name ?? "未知角色"}：${summary}`,
                  };
                }),
              ]}
              onChange={(value) => {
                if (value === "independent") {
                  onDocument(
                    updateFragment(document, fragmentId, (current) =>
                      setTimelinePointTime(current, block.id, pointTime, true),
                    ),
                  );
                  return;
                }
                if (!value.startsWith("dialogue:")) return;
                onDocument(
                  updateFragment(document, fragmentId, (current) =>
                    attachTimelineCharacterEvent(
                      current,
                      block.id,
                      value.slice("dialogue:".length),
                    ),
                  ),
                );
              }}
            />
          </Field>
          {characterTiming.mode === "independent" ? (
            <TimecodeField
              label="触发时间"
              value={pointTime}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (current) =>
                    setTimelinePointTime(current, block.id, milliseconds, true),
                  ),
                )
              }
            />
          ) : (
            <small className="galgame-field-hint">
              {characterTiming.mode === "dialogue"
                ? "移动目标对白时，角色演出会一起移动。"
                : "当前 Fragment 没有后续对白，角色演出跟随剧情结尾。"}
            </small>
          )}
        </div>
      ) : null}
      {(block.type === "scene" ||
        block.type === "hideCg" ||
        block.type === "audio") &&
      fragment?.timeline &&
      pointTime != null ? (
        <div className="galgame-block-timing" aria-label="演出事件时间点">
          <header>
            <Clock3 aria-hidden />
            <span>
              <strong>演出时间点</strong>
              <small>{block.atMs == null ? "兼容锚点" : "显式锚点"}</small>
            </span>
          </header>
          <TimecodeField
            label="触发时间"
            value={pointTime}
            onCommit={(milliseconds) =>
              onDocument(
                updateFragment(document, fragmentId, (current) =>
                  setTimelinePointTime(current, block.id, milliseconds, true),
                ),
              )
            }
          />
        </div>
      ) : null}
      <BlockInspectorFields model={model} />
    </div>
  );
}
