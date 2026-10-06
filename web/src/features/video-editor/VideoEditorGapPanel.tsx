import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, RefreshCw, X } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { planGapEdits, type GapProcessingMode } from "./gapEditPlan";
import { prepareGapFreezes } from "./gapFreeze";
import {
  findTimelineGaps,
  preciseGapTime,
  type TimelineGap,
} from "./timelineGaps";
import type { TimelineEditBuilder } from "./timelineSaveQueue";
import type { VideoEditorAsset, VideoEditorTimeline } from "./types";
import "./video-editor-gaps.css";

export function VideoEditorGapPanel({
  timeline,
  assets,
  saving,
  canWrite,
  commit,
  onLocate,
  onClose,
  onAssetsChanged,
}: {
  timeline: VideoEditorTimeline;
  assets: VideoEditorAsset[];
  saving: boolean;
  canWrite: boolean;
  commit: (build: TimelineEditBuilder) => Promise<void>;
  onLocate: (gap: TimelineGap) => void;
  onClose: () => void;
  onAssetsChanged?: () => void;
}) {
  const panel = useDrawerFocus<HTMLElement>(onClose, true, false);
  const [mode, setMode] = useState<GapProcessingMode>("extend");
  const [trackFilter, setTrackFilter] = useState("all");
  const [shortOnly, setShortOnly] = useState(false);
  const [scan, setScan] = useState(0);
  const [selection, setSelection] = useState<{ token: string; ids: string[] }>({
    token: "",
    ids: [],
  });
  const [message, setMessage] = useState("");
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const preparation = useRef<AbortController | null>(null);
  useEffect(() => () => preparation.current?.abort(), []);
  // Source metadata changes invalidate decisions even without a timeline revision.
  const token = JSON.stringify([
    timeline.revision,
    assets.map((asset) => [
      asset.id,
      asset.revision,
      asset.processingStatus,
      asset.probe,
    ]),
    scan,
  ]);
  const latest = useRef({ token, assets });
  latest.current = { token, assets };
  const gaps = useMemo(() => findTimelineGaps(timeline), [timeline]);
  const displayed = gaps.filter(
    (gap) =>
      (trackFilter === "all" || gap.trackId === trackFilter) &&
      (!shortOnly || gap.durationUs <= 100_000),
  );
  const availability = useMemo(
    () =>
      new Map(
        gaps.map((gap) => [
          gap.id,
          planGapEdits(timeline, assets, [gap], mode).issues,
        ]),
      ),
    [gaps, timeline, assets, mode],
  );
  const eligible = displayed.filter((gap) => !availability.get(gap.id)?.length);
  const selected = displayed.filter(
    (gap) =>
      selection.token === token &&
      selection.ids.includes(gap.id) &&
      !availability.get(gap.id)?.length,
  );
  const selectedPlan = planGapEdits(timeline, assets, selected, mode);
  const allPlan = planGapEdits(timeline, assets, eligible, mode);
  const busy = saving || applying;
  const blocked = busy || !canWrite;
  const fps = timeline.document.settings?.fps ?? 30;
  const changeMode = (value: string) => {
    setMode(value as GapProcessingMode);
    setSelection({ token, ids: [] });
    setMessage("");
  };
  const apply = async (targets: TimelineGap[]) => {
    if (blocked || applyingRef.current || !targets.length) return;
    const plan = planGapEdits(timeline, assets, targets, mode);
    if (plan.issues.length) {
      setMessage(plan.issues.join("；"));
      return;
    }
    applyingRef.current = true;
    setApplying(true);
    setMessage(
      mode === "freeze"
        ? "正在准备定帧素材，完成后整批保存…"
        : "正在处理并保存…",
    );
    let stale = false;
    try {
      const controller = new AbortController();
      preparation.current = controller;
      const freezeEdit =
        mode === "freeze"
          ? await prepareGapFreezes(
              timeline,
              assets,
              targets,
              controller.signal,
              () => latest.current.token === token,
            )
          : null;
      await commit((current) => {
        if (
          current.revision !== timeline.revision ||
          latest.current.token !== token
        ) {
          stale = true;
          return { redo: [], undo: [] };
        }
        const fresh = planGapEdits(
          current,
          latest.current.assets,
          targets,
          mode,
        );
        if (fresh.issues.length) {
          stale = true;
          return { redo: [], undo: [] };
        }
        return freezeEdit ?? fresh;
      });
      setSelection({ token, ids: [] });
      setMessage(
        stale
          ? "接点或素材已变化，未提交修改；请重新检查"
          : `已处理 ${targets.length} 处空隙，可一次撤销整批修改`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "处理失败，请核对未保存操作后重新检查",
      );
    } finally {
      if (mode === "freeze") onAssetsChanged?.();
      preparation.current = null;
      applyingRef.current = false;
      setApplying(false);
    }
  };
  const summary = (targets: TimelineGap[], affected: number) =>
    `${targets.length} 处 · 累计 ${(targets.reduce((sum, gap) => sum + gap.durationUs, 0) / 1000).toFixed(3)} 毫秒 · 影响 ${affected} 个片段`;
  return createPortal(
    <div className="ve-gap-overlay">
      <aside className="ve-gap-panel" aria-label="空隙检查" ref={panel}>
        <header>
          <h2>空隙检查</h2>
          <button type="button" onClick={onClose} aria-label="关闭空隙检查">
            <X aria-hidden />
          </button>
        </header>
        <div className="ve-gap-controls">
          <p>
            检查可见画面轨的内部空隙，其他轨道可能仍有画面。素材黑帧、纯黑片段和首尾留白不在此检查范围。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setScan(scan + 1);
              setSelection({ token: "", ids: [] });
              setMessage("已重新检查当前时间线");
            }}
          >
            <RefreshCw aria-hidden /> 重新检查
          </button>
          <CustomSelect
            ariaLabel="空隙轨道筛选"
            value={trackFilter}
            onChange={(value) => {
              setTrackFilter(value);
              setSelection({ token, ids: [] });
            }}
            options={[
              { value: "all", label: "全部画面轨道" },
              ...[
                ...new Map(
                  gaps.map((gap) => [gap.trackId, gap.trackName]),
                ).entries(),
              ].map(([value, label]) => ({ value, label })),
            ]}
          />
          <CustomSelect
            ariaLabel="空隙时长筛选"
            value={shortOnly ? "short" : "all"}
            onChange={(value) => {
              setShortOnly(value === "short");
              setSelection({ token, ids: [] });
            }}
            options={[
              { value: "all", label: "全部空隙" },
              { value: "short", label: "短空隙 ≤100 毫秒" },
            ]}
          />
          <CustomSelect
            ariaLabel="空隙处理方式"
            value={mode}
            onChange={changeMode}
            disabled={busy}
            options={[
              { value: "extend", label: "延长左片段，保持后续时序" },
              { value: "ripple", label: "前移后续片段，闭合空隙" },
              { value: "freeze", label: "定帧填补空隙，保持后续时序" },
            ]}
          />
          <p>
            {mode === "extend"
              ? "使用左片段及关联媒体的剩余素材填齐，后续位置、音乐和字幕保持原位。素材不足时不添加替代画面，请预览源素材是否含黑帧。"
              : mode === "ripple"
                ? "同轨后续片段及关联媒体前移，未选空隙保留原时长。独立音乐和字幕保持原位，画面与它们的对齐会改变。"
                : "取左片段末尾源画面新增静音定帧，固定末尾变换，其他片段保持原位。不会冻结其他轨道或跳过黑帧；请预览确认。视频定帧按源尺寸缩放至宽度不超过 1920，准备失败的素材保留在素材列表。"}
          </p>
          <div className="ve-gap-selection">
            <button
              type="button"
              disabled={!eligible.length || blocked}
              onClick={() =>
                setSelection({ token, ids: eligible.map((gap) => gap.id) })
              }
            >
              全选显示项
            </button>
            <button
              type="button"
              disabled={!selected.length || busy}
              onClick={() => setSelection({ token, ids: [] })}
            >
              取消全选
            </button>
            <span>{displayed.length} 处空隙</span>
          </div>
        </div>
        <div className="ve-gap-list">
          {!displayed.length ? (
            <p role="status">当前筛选没有画面空隙。</p>
          ) : null}
          {displayed.map((gap) => {
            const reason = availability.get(gap.id)?.join("；");
            const checked = selected.some((item) => item.id === gap.id);
            return (
              <article key={gap.id} className={checked ? "selected" : ""}>
                <div className="ve-gap-row">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`选择空隙：${gap.trackName} ${preciseGapTime(gap.startUs)}`}
                    disabled={busy || Boolean(reason) || !canWrite}
                    className="ve-gap-check"
                    onClick={() =>
                      setSelection({
                        token,
                        ids: checked
                          ? selected
                              .filter((item) => item.id !== gap.id)
                              .map((item) => item.id)
                          : [...selected.map((item) => item.id), gap.id],
                      })
                    }
                  >
                    {checked ? <Check aria-hidden /> : null}
                  </button>
                  <strong>{gap.trackName}</strong>
                  <span>
                    {(gap.durationUs / 1000).toFixed(3)} 毫秒 · 约{" "}
                    {((gap.durationUs * fps) / 1_000_000).toFixed(2)} 帧
                  </span>
                </div>
                <p>
                  {gap.fromName} → {gap.toName}
                </p>
                <button
                  type="button"
                  className="ve-gap-locate"
                  onClick={() => onLocate(gap)}
                  aria-label={`定位空隙 ${preciseGapTime(gap.startUs)}`}
                >
                  {preciseGapTime(gap.startUs)}–{preciseGapTime(gap.endUs)}
                </button>
                {reason ? (
                  <p className="ve-gap-error">不可处理：{reason}</p>
                ) : null}
              </article>
            );
          })}
        </div>
        <footer>
          {!canWrite ? <p>只读模式：可检查和定位，不能修改时间线。</p> : null}
          <p>选中：{summary(selected, selectedPlan.affectedClipIds.length)}</p>
          <p>
            全部可处理显示项：
            {summary(eligible, allPlan.affectedClipIds.length)}
          </p>
          {selectedPlan.issues.length ? (
            <p role="alert" className="ve-gap-error">
              {selectedPlan.issues.join("；")}
            </p>
          ) : null}
          {allPlan.issues.length ? (
            <p className="ve-gap-error">
              全部处理不可用：{allPlan.issues.join("；")}
            </p>
          ) : null}
          {message ? <p role="status">{message}</p> : null}
          <div className="ve-gap-selection">
            <button
              type="button"
              disabled={
                blocked ||
                !selected.length ||
                Boolean(selectedPlan.issues.length)
              }
              onClick={() => void apply(selected)}
            >
              处理选中
            </button>
            <button
              type="button"
              disabled={
                blocked || !eligible.length || Boolean(allPlan.issues.length)
              }
              onClick={() => void apply(eligible)}
            >
              处理全部显示项
            </button>
          </div>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
