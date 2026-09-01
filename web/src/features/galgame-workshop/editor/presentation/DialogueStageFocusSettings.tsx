import { dialogueRangeProgress as rangeProgress } from "@features/galgame-workshop/editor/presentation/dialogueStyleOptions";
import { useDialogueStyleController } from "@features/galgame-workshop/editor/presentation/useDialogueStyleController";

export function DialogueStageFocusSettings({
  controller,
}: {
  controller: ReturnType<typeof useDialogueStyleController>;
}) {
  const { stageStyle, updateStageStyle } = controller;
  return (
    <div className="galgame-dialogue-style-section galgame-stage-style-section">
      <label className="galgame-stage-checkbox">
        <input
          type="checkbox"
          checked={stageStyle.speakerFocusEnabled}
          onChange={(event) =>
            updateStageStyle({ speakerFocusEnabled: event.target.checked })
          }
        />
        <span>多人同屏时自动突出当前说话者</span>
      </label>
      <label className="galgame-stage-checkbox">
        <input
          type="checkbox"
          checked={stageStyle.lipSyncEnabled}
          onChange={(event) =>
            updateStageStyle({ lipSyncEnabled: event.target.checked })
          }
        />
        <span>使用配套闭口、半口和张口帧驱动口型</span>
      </label>
      <label className="galgame-stage-range">
        <span>
          非说话者亮度
          <em>{Math.round(stageStyle.inactiveBrightness * 100)}%</em>
        </span>
        <input
          aria-label="非说话者亮度"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={stageStyle.inactiveBrightness}
          style={rangeProgress(stageStyle.inactiveBrightness, 0, 1)}
          onChange={(event) =>
            updateStageStyle({ inactiveBrightness: Number(event.target.value) })
          }
        />
      </label>
      <label className="galgame-stage-range">
        <span>
          聚焦切换时长 <em>{stageStyle.focusTransitionMs}ms</em>
        </span>
        <input
          aria-label="聚焦切换时长"
          type="range"
          min="0"
          max="5000"
          step="50"
          value={stageStyle.focusTransitionMs}
          style={rangeProgress(stageStyle.focusTransitionMs, 0, 5000)}
          onChange={(event) =>
            updateStageStyle({ focusTransitionMs: Number(event.target.value) })
          }
        />
      </label>
    </div>
  );
}
