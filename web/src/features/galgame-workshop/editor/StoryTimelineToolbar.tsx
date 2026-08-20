import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  Maximize2,
  Pause,
  Play,
  Repeat2,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { formatTimecode } from "@features/galgame-workshop/editor/timeline";
import {
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
  type TimelinePreferences,
} from "@features/galgame-workshop/editor/timelinePreferences";
import { TimelineAdvancedSettings } from "@features/galgame-workshop/editor/TimelineAdvancedSettings";

type CharacterMap = Map<string, { name: string }>;

export function StoryTimelineToolbar({
  readOnly,
  playing,
  ready,
  positionMs,
  durationMs,
  estimated,
  addControl,
  selectedBlockId,
  loop,
  preferences,
  zoom,
  characterTrackIds,
  characterTracksExpanded,
  ripple,
  durationInput,
  visibleCharacterTrackIds,
  characters,
  skip,
  toggle,
  auditionSelected,
  setSelectedEdgeAtPlayhead,
  onPreferencesChange,
  fitTimelineWidth,
  setDurationInput,
  setDurationHint,
  commitDuration,
  setCharacterTrackVisible,
  setHiddenCharacterTrackIds,
}: {
  readOnly: boolean;
  playing: boolean;
  ready: boolean;
  positionMs: number;
  durationMs: number;
  estimated: boolean;
  addControl?: ReactNode;
  selectedBlockId?: string;
  loop: boolean;
  preferences: TimelinePreferences;
  zoom: number;
  characterTrackIds: string[];
  characterTracksExpanded: boolean;
  ripple: boolean;
  durationInput: string;
  visibleCharacterTrackIds: string[];
  characters: CharacterMap;
  skip: (direction: -1 | 1) => void;
  toggle: () => Promise<void>;
  auditionSelected: () => Promise<void>;
  setSelectedEdgeAtPlayhead: (edge: "start" | "end") => void;
  onPreferencesChange: (preferences: TimelinePreferences) => void;
  fitTimelineWidth: () => void;
  setDurationInput: Dispatch<SetStateAction<string>>;
  setDurationHint: Dispatch<SetStateAction<string>>;
  commitDuration: () => void;
  setCharacterTrackVisible: (characterId: string, visible: boolean) => void;
  setHiddenCharacterTrackIds: Dispatch<SetStateAction<Set<string>>>;
}) {
  return (
    <header className="galgame-timeline-toolbar">
      <div className="galgame-timeline-transport">
        <span className="galgame-timeline-mode-label">
          {readOnly ? "跟随试玩" : "时间轴试听"}
        </span>
        {!readOnly ? (
          <>
            <button type="button" aria-label="上一句" onClick={() => skip(-1)}>
              <SkipBack aria-hidden />
            </button>
            <button
              type="button"
              aria-label={playing ? "暂停编辑时间轴" : "播放编辑时间轴"}
              disabled={!ready}
              onClick={() => void toggle()}
            >
              {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
            </button>
            <button type="button" aria-label="下一句" onClick={() => skip(1)}>
              <SkipForward aria-hidden />
            </button>
          </>
        ) : null}
        <strong>
          {formatTimecode(positionMs)} / {formatTimecode(durationMs)}
        </strong>
        {estimated ? <em>估算时间 · 编辑后保存</em> : null}
      </div>
      {!readOnly ? addControl : null}
      {!readOnly && selectedBlockId ? (
        <details className="galgame-timeline-context-menu">
          <summary>内容项工具</summary>
          <div className="galgame-timeline-calibration">
            <button
              type="button"
              disabled={!ready}
              onClick={() => void auditionSelected()}
            >
              <Play aria-hidden /> 预听所选
            </button>
            <small>提前 300ms</small>
            <label>
              <input
                type="checkbox"
                checked={loop}
                onChange={(event) =>
                  onPreferencesChange({
                    ...preferences,
                    loop: event.target.checked,
                  })
                }
              />
              <Repeat2 aria-hidden /> 循环所选
            </label>
            <button
              type="button"
              onClick={() => setSelectedEdgeAtPlayhead("start")}
            >
              设为开始
            </button>
            <button
              type="button"
              onClick={() => setSelectedEdgeAtPlayhead("end")}
            >
              设为结束
            </button>
          </div>
        </details>
      ) : null}
      <label className="galgame-timeline-zoom">
        <span>缩放</span>
        <input
          type="range"
          min={MIN_TIMELINE_ZOOM}
          max={MAX_TIMELINE_ZOOM}
          step="60"
          value={zoom}
          aria-label="时间轴缩放"
          onChange={(event) =>
            onPreferencesChange({
              ...preferences,
              zoom: Number(event.target.value),
            })
          }
        />
      </label>
      <button
        type="button"
        className="galgame-timeline-fit"
        aria-label="适配时间轴宽度"
        title="在当前窗口中显示完整剧情"
        onClick={fitTimelineWidth}
      >
        <Maximize2 aria-hidden />
        适配宽度
      </button>
      {characterTrackIds.length ? (
        <label
          className="galgame-timeline-performance-details"
          title="展开逐角色轨道，检查独立或精确角色演出"
        >
          <input
            type="checkbox"
            checked={characterTracksExpanded}
            onChange={(event) =>
              onPreferencesChange({
                ...preferences,
                characterTracksExpanded: event.target.checked,
              })
            }
          />
          <span>演出细节</span>
        </label>
      ) : null}
      {!readOnly ? (
        <>
          <label
            className="galgame-timeline-ripple"
            title="移动对白或拉伸右边界时，同步推移后续对白"
          >
            <input
              type="checkbox"
              checked={ripple}
              onChange={(event) =>
                onPreferencesChange({
                  ...preferences,
                  ripple: event.target.checked,
                })
              }
            />
            <span>波纹编辑</span>
          </label>
          <TimelineAdvancedSettings
            durationInput={durationInput}
            readOnly={readOnly}
            characterTrackIds={characterTrackIds}
            visibleCharacterTrackIds={visibleCharacterTrackIds}
            characterNames={
              new Map(
                Array.from(characters, ([id, character]) => [
                  id,
                  character.name,
                ]),
              )
            }
            onDurationInput={(value) => {
              setDurationInput(value);
              setDurationHint("");
            }}
            onDurationCommit={commitDuration}
            onCharacterTrackVisible={setCharacterTrackVisible}
            onShowAllCharacterTracks={() =>
              setHiddenCharacterTrackIds(new Set())
            }
            onHideAllCharacterTracks={() =>
              setHiddenCharacterTrackIds(new Set(characterTrackIds))
            }
          />
        </>
      ) : null}
    </header>
  );
}
