import { formatTimecode } from "@features/galgame-workshop/editor/timeline";
import { StoryTimelineToolbar } from "@features/galgame-workshop/editor/StoryTimelineToolbar";
import { useStoryTimelineController } from "@features/galgame-workshop/editor/timeline/useStoryTimelineController";

export function StoryTimelineToolbarPanel({
  controller,
}: {
  controller: ReturnType<typeof useStoryTimelineController>;
}) {
  const {
    readOnly,
    playing,
    ready,
    displayPositionMs,
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
    rulerScrollRef,
    trackWidth,
    ticks,
  } = controller;
  return (
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
  );
}
