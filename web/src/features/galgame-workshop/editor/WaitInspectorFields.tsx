import { WAIT_DURATION_PRESETS } from "@features/galgame-workshop/editor/blockRegistry";
import "@features/galgame-workshop/galgame-workshop.css";
import "@features/galgame-workshop/galgame-script-workbench.css";
import type { BlockInspectorViewModel } from "@features/galgame-workshop/editor/InspectorFieldControls";
export function WaitInspectorFields({
  model,
}: {
  model: BlockInspectorViewModel;
}) {
  const { block, patch } = model;
  if (!block || block.type !== "wait" || !patch) return null;
  return (
    <div className="galgame-wait-inspector">
      <section>
        <span>模式</span>
        <div
          className="galgame-inspector-segments"
          role="group"
          aria-label="等待模式"
        >
          <button
            type="button"
            className={block.mode === "duration" ? "active" : ""}
            aria-pressed={block.mode === "duration"}
            onClick={() =>
              patch((current) =>
                current.type === "wait"
                  ? {
                      ...current,
                      mode: "duration",
                      durationMs: current.durationMs ?? 1000,
                    }
                  : current,
              )
            }
          >
            等待指定时间
          </button>
          <button
            type="button"
            className={block.mode === "player" ? "active" : ""}
            aria-pressed={block.mode === "player"}
            onClick={() =>
              patch((current) =>
                current.type === "wait"
                  ? { ...current, mode: "player", durationMs: null }
                  : current,
              )
            }
          >
            等待玩家继续
          </button>
        </div>
      </section>
      {block.mode === "duration" ? (
        <>
          <label className="galgame-inspector-number-row">
            <span>时长</span>
            <div>
              <input
                aria-label="等待时长"
                type="number"
                min="0"
                max="3600000"
                value={block.durationMs ?? 1000}
                onChange={(event) =>
                  patch((current) =>
                    current.type === "wait"
                      ? {
                          ...current,
                          durationMs: Math.min(
                            3600000,
                            Math.max(0, Number(event.target.value)),
                          ),
                        }
                      : current,
                  )
                }
              />
              <em>ms</em>
            </div>
          </label>
          <section>
            <span>预设</span>
            <div className="galgame-wait-presets">
              {WAIT_DURATION_PRESETS.map((durationMs) => (
                <button
                  key={durationMs}
                  type="button"
                  className={block.durationMs === durationMs ? "active" : ""}
                  onClick={() =>
                    patch((current) =>
                      current.type === "wait"
                        ? { ...current, durationMs }
                        : current,
                    )
                  }
                >
                  {durationMs}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  patch((current) =>
                    current.type === "wait"
                      ? { ...current, mode: "player", durationMs: null }
                      : current,
                  )
                }
              >
                等待玩家继续
              </button>
            </div>
          </section>
        </>
      ) : (
        <p className="galgame-inspector-note">
          自动播放和跳过模式都不会越过此 Block，必须由玩家继续。
        </p>
      )}
    </div>
  );
}
