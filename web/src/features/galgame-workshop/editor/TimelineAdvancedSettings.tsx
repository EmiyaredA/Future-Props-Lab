import { Eye, EyeOff, Settings2, UserRound } from "lucide-react";
export function TimelineAdvancedSettings({
  durationInput,
  readOnly,
  characterTrackIds,
  visibleCharacterTrackIds,
  characterNames,
  onDurationInput,
  onDurationCommit,
  onCharacterTrackVisible,
  onShowAllCharacterTracks,
  onHideAllCharacterTracks,
}: {
  durationInput: string;
  readOnly: boolean;
  characterTrackIds: string[];
  visibleCharacterTrackIds: string[];
  characterNames: ReadonlyMap<string, string>;
  onDurationInput: (value: string) => void;
  onDurationCommit: () => void;
  onCharacterTrackVisible: (characterId: string, visible: boolean) => void;
  onShowAllCharacterTracks: () => void;
  onHideAllCharacterTracks: () => void;
}) {
  return (
    <details className="galgame-timeline-advanced">
      <summary aria-label="精确设置" title="精确设置">
        <Settings2 aria-hidden />
      </summary>
      <div className="galgame-timeline-advanced-content">
        <header>
          <strong>精确设置</strong>
          <small>时间与演出视图</small>
        </header>
        <div className="galgame-timeline-advanced-fields">
          <div className="galgame-timeline-lengths">
            <label>
              <span>剧情长度</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label="剧情时间轴总长"
                value={durationInput}
                disabled={readOnly}
                onChange={(event) => onDurationInput(event.target.value)}
                onBlur={onDurationCommit}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  onDurationCommit();
                  event.currentTarget.blur();
                }}
              />
            </label>
          </div>
          {characterTrackIds.length ? (
            <details className="galgame-timeline-track-visibility">
              <summary>
                {visibleCharacterTrackIds.length ? (
                  <Eye aria-hidden />
                ) : (
                  <EyeOff aria-hidden />
                )}
                逐角色轨道 {visibleCharacterTrackIds.length}/
                {characterTrackIds.length}
              </summary>
              <div aria-label="逐角色轨道显示设置">
                <header>
                  <strong>逐角色轨道</strong>
                  <span>
                    <button
                      type="button"
                      disabled={
                        visibleCharacterTrackIds.length ===
                        characterTrackIds.length
                      }
                      onClick={onShowAllCharacterTracks}
                    >
                      全部显示
                    </button>
                    <button
                      type="button"
                      disabled={!visibleCharacterTrackIds.length}
                      onClick={onHideAllCharacterTracks}
                    >
                      全部隐藏
                    </button>
                  </span>
                </header>
                <small>仅在“演出细节”中显示；隐藏不会删除角色事件。</small>
                <fieldset>
                  {characterTrackIds.map((characterId) => (
                    <label key={characterId}>
                      <input
                        type="checkbox"
                        checked={visibleCharacterTrackIds.includes(characterId)}
                        onChange={(event) =>
                          onCharacterTrackVisible(
                            characterId,
                            event.target.checked,
                          )
                        }
                      />
                      <UserRound aria-hidden />
                      <span>
                        {characterNames.get(characterId) ?? "未知角色"}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </details>
  );
}
