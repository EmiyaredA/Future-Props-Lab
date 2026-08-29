import {
  Images,
  MapPinned,
  Music2,
  Unlink2,
  UserRound,
  Users,
  Volume2,
  Waves,
} from "lucide-react";
import {
  formatTimecode,
  resizeTimelineCueEnd,
  timelineCharacterTiming,
  timelineStructureEvents,
} from "@features/galgame-workshop/editor/timeline";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import { TimelineTrackLabels } from "@features/galgame-workshop/editor/TimelineTrackLabels";
import { StoryTimelineToolbar } from "@features/galgame-workshop/editor/StoryTimelineToolbar";
import { timelineCharacterColor } from "@features/galgame-workshop/editor/timelineCharacterColor";
import { useStoryTimelineController } from "@features/galgame-workshop/editor/timeline/useStoryTimelineController";

export function StoryTimelineTracksView({
  controller,
}: {
  controller: ReturnType<typeof useStoryTimelineController>;
}) {
  const {
    document,
    fragment,
    selectedBlockId,
    selectedGapId,
    onSelectGap,
    onFragment,
    preferences,
    onPreferencesChange,
    onRequestAddMenu,
    addControl,
    readOnly,
    estimated,
    zoom,
    ripple,
    loop,
    characterTracksExpanded,
    playing,
    ready,
    durationInput,
    setDurationInput,
    durationHint,
    setDurationHint,
    error,
    setHiddenCharacterTrackIds,
    scrollRef,
    rulerScrollRef,
    trackRef,
    attachedCharacterEvents,
    cgs,
    cgRanges,
    characterTrackIds,
    characters,
    cues,
    durationMs,
    gaps,
    markers,
    pointEvents,
    stateSegments,
    displayPositionMs,
    trackWidth,
    activeCue,
    visibleCharacterTrackIds,
    setCharacterTrackVisible,
    laneHeight,
    lanes,
    laneTop,
    dialogueTop,
    trackHeight,
    seek,
    startPlayheadDrag,
    seekPlayheadWithKeyboard,
    toggle,
    auditionSelected,
    commitDuration,
    setSelectedEdgeAtPlayhead,
    skip,
    startDrag,
    moveWithKeyboard,
    moveCueEdgeWithKeyboard,
    moveGapEdgeWithKeyboard,
    moveCgRangeWithKeyboard,
    ticks,
    selectBlock,
    fitTimelineWidth,
  } = controller;
  return (
    <section
      className={`galgame-timeline-editor${readOnly ? " is-readonly" : ""}`}
      aria-label={readOnly ? "试玩剧情时间轴" : "多轨剧情时间轴"}
    >
      <div className="galgame-timeline-controls">
        <StoryTimelineToolbar
          readOnly={readOnly}
          playing={playing}
          ready={ready}
          positionMs={displayPositionMs}
          durationMs={durationMs}
          estimated={estimated}
          addControl={addControl}
          selectedBlockId={selectedBlockId}
          loop={loop}
          preferences={preferences}
          zoom={zoom}
          characterTrackIds={characterTrackIds}
          characterTracksExpanded={characterTracksExpanded}
          ripple={ripple}
          durationInput={durationInput}
          visibleCharacterTrackIds={visibleCharacterTrackIds}
          characters={characters}
          skip={skip}
          toggle={toggle}
          auditionSelected={auditionSelected}
          setSelectedEdgeAtPlayhead={setSelectedEdgeAtPlayhead}
          onPreferencesChange={onPreferencesChange}
          fitTimelineWidth={fitTimelineWidth}
          setDurationInput={setDurationInput}
          setDurationHint={setDurationHint}
          commitDuration={commitDuration}
          setCharacterTrackVisible={setCharacterTrackVisible}
          setHiddenCharacterTrackIds={setHiddenCharacterTrackIds}
        />
        <div className="galgame-timeline-ruler-row">
          <strong>时间</strong>
          <div ref={rulerScrollRef} className="galgame-timeline-ruler-scroll">
            <div
              className="galgame-timeline-ruler"
              style={{ width: `${trackWidth}px` }}
              aria-hidden
            >
              {ticks.map((tick) => (
                <i
                  key={tick}
                  className={tick % 60_000 === 0 ? "major" : ""}
                  style={{
                    left: `${(tick / Math.max(1, durationMs)) * trackWidth}px`,
                  }}
                >
                  <span>{formatTimecode(tick).slice(0, 5)}</span>
                </i>
              ))}
            </div>
          </div>
        </div>
      </div>
      {durationHint ? (
        <small className="galgame-timeline-hint" role="status">
          {durationHint}
        </small>
      ) : null}
      {error ? <small className="galgame-timeline-error">{error}</small> : null}
      <div
        ref={scrollRef}
        className="galgame-timeline-scroll"
        onScroll={(event) => {
          if (rulerScrollRef.current)
            rulerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        <div
          className="galgame-timeline-track"
          style={{
            width: `calc(${trackWidth}px + var(--galgame-timeline-label-width))`,
            height: `${trackHeight}px`,
          }}
        >
          <TimelineTrackLabels
            lanes={lanes}
            laneHeight={laneHeight}
            laneTop={laneTop}
          />
          <div
            ref={trackRef}
            className="galgame-timeline-time-area"
            style={{ width: `${trackWidth}px`, height: `${trackHeight}px` }}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              seek(((event.clientX - bounds.left) / bounds.width) * durationMs);
            }}
            onContextMenu={(event) => {
              if (readOnly || !onRequestAddMenu) return;
              const target = event.target;
              if (
                target instanceof Element &&
                target.closest(
                  "button, input, textarea, [role='button'], [role='separator']",
                )
              )
                return;
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              seek(((event.clientX - bounds.left) / bounds.width) * durationMs);
              onRequestAddMenu();
            }}
          >
            <div className="galgame-timeline-lanes" aria-hidden>
              {lanes.map((lane) => (
                <div
                  key={lane.id}
                  className="galgame-timeline-lane"
                  style={{
                    top: `${laneTop(lane.id)}px`,
                    height: `${laneHeight}px`,
                  }}
                />
              ))}
            </div>
            {stateSegments
              .filter(
                (segment) =>
                  lanes.some((lane) => lane.id === segment.laneId) &&
                  segment.laneId !== "cg",
              )
              .map((segment) => (
                <div
                  key={segment.id}
                  className={`galgame-timeline-state-segment is-${segment.kind}`}
                  style={{
                    left: `${(segment.startMs / Math.max(1, durationMs)) * 100}%`,
                    top: `${laneTop(segment.laneId) + 8}px`,
                    width: `${
                      ((segment.endMs - segment.startMs) /
                        Math.max(1, durationMs)) *
                      100
                    }%`,
                  }}
                  title={`${segment.label} · 持续到 ${formatTimecode(segment.endMs)}`}
                  aria-hidden
                >
                  {segment.kind === "scene" ? (
                    <MapPinned />
                  ) : segment.kind === "character" ? (
                    <UserRound />
                  ) : segment.kind === "bgm" ? (
                    <Music2 />
                  ) : segment.kind === "ambient" ? (
                    <Waves />
                  ) : null}
                  <span>{segment.label}</span>
                </div>
              ))}
            {lanes.some((lane) => lane.id === "cg")
              ? cgRanges.map((range) => {
                  const label =
                    cgs.get(range.showBlock.cgId)?.name ?? "剧情 CG";
                  return (
                    <div
                      key={range.id}
                      role="button"
                      tabIndex={readOnly ? -1 : 0}
                      className={`galgame-timeline-cg-range${range.showBlock.id === selectedBlockId ? " selected" : ""}`}
                      style={{
                        left: `${(range.startMs / Math.max(1, durationMs)) * 100}%`,
                        top: `${laneTop("cg") + 8}px`,
                        width: `${((range.endMs - range.startMs) / Math.max(1, durationMs)) * 100}%`,
                        height: `${laneHeight - 16}px`,
                      }}
                      aria-label={`${label} ${formatTimecode(range.startMs)} 到 ${formatTimecode(range.endMs)}`}
                      title={`${label} · ${formatTimecode(range.startMs)}–${formatTimecode(range.endMs)}`}
                      onClick={() => {
                        selectBlock(range.showBlock.id);
                        seek(range.startMs);
                      }}
                      onPointerDown={(event) =>
                        startDrag(event, "cg-range", range.showBlock.id)
                      }
                      onKeyDown={(event) =>
                        moveCgRangeWithKeyboard(event, range.showBlock.id)
                      }
                    >
                      <i
                        role="separator"
                        tabIndex={readOnly ? -1 : 0}
                        className="start"
                        aria-label={`调整 ${label} 的开始时间`}
                        onPointerDown={(event) =>
                          startDrag(event, "cg-start", range.showBlock.id)
                        }
                        onKeyDown={(event) =>
                          moveCgRangeWithKeyboard(
                            event,
                            range.showBlock.id,
                            "start",
                          )
                        }
                      />
                      <Images aria-hidden />
                      <strong>{label}</strong>
                      <span>{formatTimecode(range.endMs - range.startMs)}</span>
                      <i
                        role="separator"
                        tabIndex={readOnly ? -1 : 0}
                        className="end"
                        aria-label={`调整 ${label} 的结束时间`}
                        onPointerDown={(event) =>
                          startDrag(event, "cg-end", range.showBlock.id)
                        }
                        onKeyDown={(event) =>
                          moveCgRangeWithKeyboard(
                            event,
                            range.showBlock.id,
                            "end",
                          )
                        }
                      />
                    </div>
                  );
                })
              : null}
            {pointEvents.map((event) => {
              const block = event.block;
              const characterEvent =
                block.type === "showCharacter" ||
                block.type === "removeCharacter";
              const characterTiming = characterEvent
                ? timelineCharacterTiming(fragment, block.id)
                : undefined;
              const collapsedCharacterEvent =
                characterEvent &&
                !characterTracksExpanded &&
                characterTiming?.mode !== "dialogue";
              const isCgEvent =
                block.type === "showCg" || block.type === "hideCg";
              const isStateEvent =
                block.type === "scene" ||
                block.type === "showCharacter" ||
                block.type === "removeCharacter" ||
                (block.type === "audio" &&
                  (block.channel === "bgm" || block.channel === "ambient"));
              const laneId =
                block.type === "scene"
                  ? "scene"
                  : block.type === "showCg" || block.type === "hideCg"
                    ? "cg"
                    : block.type === "showCharacter" ||
                        block.type === "removeCharacter"
                      ? characterTracksExpanded
                        ? `character:${block.characterId ?? visibleCharacterTrackIds[0] ?? "unknown"}`
                        : "dialogue"
                      : block.type === "audio"
                        ? block.channel
                        : "structure";
              if (
                characterEvent &&
                !characterTracksExpanded &&
                characterTiming?.mode === "dialogue"
              )
                return null;
              if (!lanes.some((lane) => lane.id === laneId)) return null;
              const asset =
                block.type === "audio"
                  ? (document.assets ?? []).find(
                      (candidate) => candidate.id === block.assetId,
                    )
                  : undefined;
              const label =
                block.type === "scene"
                  ? ((document.scenes ?? []).find(
                      (scene) => scene.id === block.sceneId,
                    )?.name ?? "场景")
                  : block.type === "showCg"
                    ? `显示 · ${cgs.get(block.cgId)?.name ?? "剧情 CG"}`
                    : block.type === "hideCg"
                      ? "隐藏 CG"
                      : block.type === "showCharacter"
                        ? `登场 · ${characters.get(block.characterId)?.name ?? "角色"}`
                        : block.type === "removeCharacter"
                          ? block.all
                            ? "全部退场"
                            : `退场 · ${characters.get(block.characterId ?? "")?.name ?? "角色"}`
                          : block.type === "audio"
                            ? block.action === "stop"
                              ? "停止"
                              : asset?.type === "audio"
                                ? asset.label
                                : "声音"
                            : "事件";
              return (
                <button
                  key={block.id}
                  type="button"
                  className={`galgame-timeline-point${
                    isCgEvent
                      ? ` is-cg-event is-${block.type === "showCg" ? "show" : "hide"}-cg`
                      : ""
                  }${
                    block.type === "audio" && block.channel === "sfx"
                      ? " is-sfx-event"
                      : ""
                  }${
                    isStateEvent
                      ? ` is-state-event is-${
                          block.type === "scene"
                            ? "scene"
                            : block.type === "showCharacter" ||
                                block.type === "removeCharacter"
                              ? "character"
                              : block.channel
                        }-event`
                      : ""
                  }${collapsedCharacterEvent ? " is-character-summary-event" : ""}${
                    characterTiming?.mode === "independent"
                      ? " is-independent-event"
                      : ""
                  }${
                    event.timeMs <= 0 && !collapsedCharacterEvent
                      ? " is-timeline-start"
                      : ""
                  }${
                    block.id === selectedBlockId && block.type !== "showCg"
                      ? " selected"
                      : ""
                  }`}
                  style={{
                    left: `${(event.timeMs / Math.max(1, durationMs)) * 100}%`,
                    top: `${laneTop(laneId) + 7}px`,
                  }}
                  title={`${label} · ${formatTimecode(event.timeMs)}${
                    characterTiming?.mode === "independent"
                      ? " · 独立演出"
                      : characterTiming?.mode === "timelineEnd"
                        ? " · 跟随剧情结尾"
                        : event.explicit
                          ? ""
                          : " · 跟随对白"
                  }`}
                  aria-label={`${label} ${formatTimecode(event.timeMs)}`}
                  onClick={() => {
                    selectBlock(block.id);
                    seek(event.timeMs);
                  }}
                  onPointerDown={(pointer) =>
                    startDrag(
                      pointer,
                      block.type === "showCg" ? "cg-start" : "point",
                      block.id,
                    )
                  }
                  disabled={readOnly}
                >
                  {block.type === "scene" ? (
                    <MapPinned aria-hidden />
                  ) : block.type === "showCg" || block.type === "hideCg" ? (
                    <Images aria-hidden />
                  ) : characterEvent ? (
                    characterTiming?.mode === "independent" ? (
                      <Unlink2 aria-hidden />
                    ) : (
                      <UserRound aria-hidden />
                    )
                  ) : block.type === "audio" && block.channel === "bgm" ? (
                    <Music2 aria-hidden />
                  ) : block.type === "audio" && block.channel === "ambient" ? (
                    <Waves aria-hidden />
                  ) : (
                    <Volume2 aria-hidden />
                  )}
                  {!isCgEvent && !isStateEvent ? <span>{label}</span> : null}
                </button>
              );
            })}
            {timelineStructureEvents(fragment).map(({ block }) =>
              block.type === "branch" || block.type === "endChapter" ? (
                <button
                  key={block.id}
                  type="button"
                  className={`galgame-timeline-structure${block.id === selectedBlockId ? " selected" : ""}`}
                  style={{
                    left: `calc(100% - 28px)`,
                    top: `${laneTop("structure") + 7}px`,
                  }}
                  onClick={() => {
                    selectBlock(block.id);
                    seek(durationMs);
                  }}
                >
                  {block.type === "branch" ? "分支" : "结局"}
                </button>
              ) : null,
            )}
            <div
              className="galgame-timeline-gaps"
              style={{ inset: 0, height: `${trackHeight}px` }}
            >
              {gaps.map((gap) => {
                const left = (gap.startMs / Math.max(1, durationMs)) * 100;
                const width =
                  ((gap.endMs - gap.startMs) / Math.max(1, durationMs)) * 100;
                return (
                  <div
                    key={gap.id}
                    role="button"
                    tabIndex={0}
                    className={`galgame-timeline-gap${gap.id === selectedGapId ? " selected" : ""}`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      top: `${dialogueTop + 8}px`,
                      height: `${laneHeight - 16}px`,
                    }}
                    aria-label={`无对白 ${formatTimecode(gap.startMs)} 到 ${formatTimecode(gap.endMs)}`}
                    title={`无对白 · ${formatTimecode(gap.startMs)}–${formatTimecode(gap.endMs)}`}
                    onClick={() => {
                      onSelectGap(gap.id);
                      seek(gap.startMs);
                    }}
                  >
                    <strong>无对白</strong>
                    <span>{formatTimecode(gap.endMs - gap.startMs)}</span>
                    {gap.previousCueId ? (
                      <i
                        role="separator"
                        tabIndex={0}
                        className="start"
                        aria-label="调整无对白开始时间"
                        onPointerDown={(event) =>
                          startDrag(event, "gap-start", gap.id)
                        }
                        onKeyDown={(event) =>
                          moveGapEdgeWithKeyboard(event, gap.id, "start")
                        }
                      />
                    ) : null}
                    {gap.nextCueId ? (
                      <i
                        role="separator"
                        tabIndex={0}
                        className="end"
                        aria-label="调整无对白结束时间"
                        onPointerDown={(event) =>
                          startDrag(event, "gap-end", gap.id)
                        }
                        onKeyDown={(event) =>
                          moveGapEdgeWithKeyboard(event, gap.id, "end")
                        }
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div
              className="galgame-timeline-cues"
              style={{ inset: 0, height: `${trackHeight}px` }}
            >
              {cues.map((cue, index) => {
                const speakerIds =
                  cue.block.type === "dialogue"
                    ? dialogueSpeakerIds(cue.block)
                    : [];
                const characterId =
                  cue.block.type === "dialogue"
                    ? (speakerIds[0] ?? cue.block.characterId)
                    : "narration";
                const speakerName =
                  cue.block.type === "dialogue"
                    ? speakerIds
                        .map(
                          (speakerId) =>
                            characters.get(speakerId)?.name ?? "未知角色",
                        )
                        .join("、")
                    : "旁白";
                const cueMarkers = (markers.get(cue.block.id) ?? []).filter(
                  (block) =>
                    block.type !== "showCharacter" &&
                    block.type !== "setStageCast" &&
                    block.type !== "removeCharacter",
                );
                const cueCharacterEvents = !characterTracksExpanded
                  ? (attachedCharacterEvents.get(cue.block.id) ?? [])
                  : [];
                const dialogueCharacter =
                  cue.block.type === "dialogue"
                    ? characters.get(cue.block.characterId)
                    : undefined;
                const dialogueBlock =
                  cue.block.type === "dialogue" ? cue.block : undefined;
                const expressionLabel = dialogueBlock
                  ? dialogueCharacter?.expressions?.find(
                      (expression) =>
                        expression.id ===
                        (dialogueBlock.expressionId ??
                          dialogueCharacter.defaultExpressionId),
                    )?.label
                  : undefined;
                const portraitLabel = !dialogueBlock
                  ? undefined
                  : !dialogueBlock.portrait
                    ? "旧版临时立绘"
                    : dialogueBlock.portrait.mode === "stage"
                      ? dialogueBlock.portrait.keepAfter
                        ? "舞台·保留"
                        : "舞台·句后退场"
                      : dialogueBlock.portrait.mode === "dialogueAvatar"
                        ? "仅对白头像"
                        : dialogueBlock.portrait.visible === false
                          ? "隐藏立绘"
                          : "旧版单人特写";
                const dialogueMeta = [
                  expressionLabel ? `表情 ${expressionLabel}` : undefined,
                  dialogueBlock
                    ? dialogueBlock.voiceAssetId
                      ? "已配音"
                      : "待配音"
                    : undefined,
                  portraitLabel,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const left = (cue.startMs / Math.max(1, durationMs)) * 100;
                const width =
                  ((cue.endMs - cue.startMs) / Math.max(1, durationMs)) * 100;
                const selected = cue.block.id === selectedBlockId;
                const active = cue.block.id === activeCue?.block.id;
                return (
                  <div
                    key={cue.block.id}
                    role="button"
                    tabIndex={0}
                    className={`galgame-timeline-cue${selected ? " selected" : ""}${active ? " active" : ""}`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      top: `${dialogueTop + 8}px`,
                      height: `${laneHeight - 16}px`,
                      backgroundColor: timelineCharacterColor(characterId),
                    }}
                    aria-label={`${speakerName} ${formatTimecode(cue.startMs)} 到 ${formatTimecode(cue.endMs)}`}
                    title={`${speakerName} · ${cue.block.text}\n${formatTimecode(cue.startMs)}–${formatTimecode(cue.endMs)}`}
                    onClick={() => {
                      selectBlock(cue.block.id);
                      seek(cue.startMs);
                    }}
                    onPointerDown={(event) =>
                      startDrag(event, "cue", cue.block.id)
                    }
                    onKeyDown={(event) => moveWithKeyboard(event, cue.block.id)}
                  >
                    {index === 0 ? (
                      <i
                        role="separator"
                        tabIndex={0}
                        className="start"
                        aria-label={`调整${speakerName}的开始时间`}
                        onPointerDown={(event) =>
                          startDrag(event, "cue-start", cue.block.id)
                        }
                        onKeyDown={(event) =>
                          moveCueEdgeWithKeyboard(event, cue.block.id, "start")
                        }
                      />
                    ) : null}
                    {cueMarkers.length ? (
                      <span className="galgame-timeline-markers">
                        {cueMarkers.some((block) => block.type === "scene") ? (
                          <MapPinned aria-hidden />
                        ) : cueMarkers.some(
                            (block) =>
                              block.type === "showCg" ||
                              block.type === "hideCg",
                          ) ? (
                          <Images aria-hidden />
                        ) : (
                          <Users aria-hidden />
                        )}
                        {cueMarkers.length}
                      </span>
                    ) : null}
                    {cueCharacterEvents.length ? (
                      <span
                        className="galgame-timeline-character-markers"
                        title={cueCharacterEvents
                          .map((block) =>
                            block.type === "setStageCast"
                              ? (block.members ?? []).length
                                ? `构图 · ${(block.members ?? [])
                                    .map(
                                      (member) =>
                                        characters.get(member.characterId)
                                          ?.name ?? "角色",
                                    )
                                    .join("、")}`
                                : "清空角色"
                              : block.type === "showCharacter"
                                ? `登场 · ${characters.get(block.characterId)?.name ?? "角色"}`
                                : block.all
                                  ? "全部退场"
                                  : `退场 · ${characters.get(block.characterId ?? "")?.name ?? "角色"}`,
                          )
                          .join("\n")}
                      >
                        <UserRound aria-hidden />
                        {cueCharacterEvents.length}
                      </span>
                    ) : null}
                    <strong>{speakerName}</strong>
                    <span>{cue.block.text}</span>
                    {dialogueMeta ? (
                      <span
                        className="galgame-timeline-dialogue-meta"
                        title={dialogueMeta}
                      >
                        {dialogueBlock?.voiceAssetId ? (
                          <Volume2 aria-hidden />
                        ) : null}
                        {expressionLabel ?? portraitLabel}
                      </span>
                    ) : null}
                    {index < cues.length - 1 ? (
                      <i
                        role="separator"
                        tabIndex={0}
                        aria-label={`调整${speakerName}后的对白分界`}
                        onPointerDown={(event) =>
                          startDrag(event, "boundary", cue.block.id)
                        }
                        onKeyDown={(event) => {
                          if (
                            readOnly ||
                            (event.key !== "ArrowLeft" &&
                              event.key !== "ArrowRight")
                          )
                            return;
                          event.preventDefault();
                          event.stopPropagation();
                          const step = event.shiftKey ? 1000 : 100;
                          onFragment(
                            resizeTimelineCueEnd(
                              fragment,
                              cue.block.id,
                              cue.endMs +
                                (event.key === "ArrowRight" ? step : -step),
                              {
                                precise: true,
                                ripple,
                                keepContinuous: true,
                              },
                            ),
                          );
                        }}
                      />
                    ) : (
                      <i
                        role="separator"
                        tabIndex={0}
                        className="end"
                        aria-label={`调整${speakerName}的结束时间`}
                        onPointerDown={(event) =>
                          startDrag(event, "cue-end", cue.block.id)
                        }
                        onKeyDown={(event) =>
                          moveCueEdgeWithKeyboard(event, cue.block.id, "end")
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div
              className="galgame-timeline-playhead"
              style={{
                left: `${(displayPositionMs / Math.max(1, durationMs)) * 100}%`,
              }}
              role="slider"
              tabIndex={readOnly ? -1 : 0}
              aria-label="时间轴播放头"
              aria-valuemin={0}
              aria-valuemax={durationMs}
              aria-valuenow={Math.round(displayPositionMs)}
              aria-valuetext={formatTimecode(displayPositionMs)}
              aria-disabled={readOnly || undefined}
              title={readOnly ? undefined : "拖动播放头跳转时间"}
              onPointerDown={startPlayheadDrag}
              onKeyDown={seekPlayheadWithKeyboard}
            />
          </div>
        </div>
      </div>
      <footer>
        <span>{cues.length} 句对白</span>
        <span>
          {ripple
            ? "波纹：拉伸右边界会推移后续对白"
            : "普通：拖动分界调整相邻切点"}
          {" · Alt 精确到 1ms · Shift+方向键 1s"}
        </span>
      </footer>
    </section>
  );
}
