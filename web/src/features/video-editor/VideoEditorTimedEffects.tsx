import { useState } from "react";
import { Trash2 } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { transitionLabel } from "./transitionCatalog";
import type { TimelineEditBuilder } from "./timelineSaveQueue";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimedEffect,
} from "./types";
import "./video-editor-timed-effects.css";

const kinds = [
  "flash",
  "whip-pan",
  "light-leak",
  "spin-blur",
  "zoom",
  "blur",
] as const;
const kindOptions = kinds.map((kind) => ({
  value: kind,
  label: transitionLabel(kind),
}));
const directions = [
  { value: "left", label: "向左" },
  { value: "right", label: "向右" },
  { value: "up", label: "向上" },
  { value: "down", label: "向下" },
];
const easings = [
  { value: "linear", label: "线性" },
  { value: "ease-in", label: "缓入" },
  { value: "ease-out", label: "缓出" },
  { value: "ease-in-out", label: "缓入缓出" },
];
const envelopes = [
  { value: "pulse", label: "增强再减弱" },
  { value: "rise", label: "渐强" },
  { value: "fall", label: "渐弱" },
];
const envelopeName = (effect: VideoEditorTimedEffect) => {
  const start = effect.progressStart ?? 0;
  const end = effect.progressEnd ?? 1;
  if (start === 0 && end === 1) return "pulse";
  if (start === 0 && end === 0.5) return "rise";
  if (start === 0.5 && end === 1) return "fall";
  return "cropped";
};
type Commit = (
  redo: VideoEditorOperation[] | TimelineEditBuilder,
  undo?: VideoEditorOperation[],
) => Promise<void>;

function EffectFields({
  effect,
  durationUs,
  busy,
  save,
  remove,
}: {
  effect: VideoEditorTimedEffect;
  durationUs: number;
  busy: boolean;
  save: (effect: VideoEditorTimedEffect) => void;
  remove: () => void;
}) {
  const [draft, setDraft] = useState(effect);
  const [start, setStart] = useState(String(effect.startUs / 1_000_000));
  const [duration, setDuration] = useState(
    String(effect.durationUs / 1_000_000),
  );
  const nextStart = Math.round(Number(start) * 1_000_000);
  const nextDuration = Math.round(Number(duration) * 1_000_000);
  const valid =
    start.trim() !== "" &&
    duration.trim() !== "" &&
    Number.isFinite(nextStart) &&
    Number.isFinite(nextDuration) &&
    nextStart >= 0 &&
    nextDuration > 0 &&
    nextStart + nextDuration <= durationUs;
  return (
    <fieldset className="ve-timed-effect" disabled={busy}>
      <legend>{transitionLabel(effect.kind)}</legend>
      <CustomSelect
        ariaLabel="片内效果类型"
        value={draft.kind}
        options={kindOptions}
        disabled={busy}
        onChange={(kind) =>
          setDraft({ ...draft, kind: kind as VideoEditorTimedEffect["kind"] })
        }
      />
      <div className="ve-timed-effect-times">
        <label>
          开始（秒）
          <input
            aria-label="片内效果开始秒"
            type="number"
            min="0"
            step="0.001"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          持续（秒）
          <input
            aria-label="片内效果持续秒"
            type="number"
            min="0.000001"
            step="0.001"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
      </div>
      {(draft.kind === "whip-pan" || draft.kind === "light-leak") && (
        <CustomSelect
          ariaLabel="片内效果方向"
          value={draft.direction ?? "left"}
          options={directions}
          disabled={busy}
          onChange={(direction) =>
            setDraft({
              ...draft,
              direction: direction as VideoEditorTimedEffect["direction"],
            })
          }
        />
      )}
      <CustomSelect
        ariaLabel="片内效果缓动"
        value={draft.easing ?? "linear"}
        options={easings}
        disabled={busy}
        onChange={(easing) =>
          setDraft({
            ...draft,
            easing: easing as VideoEditorTimedEffect["easing"],
          })
        }
      />
      <CustomSelect
        ariaLabel="片内效果变化方式"
        value={envelopeName(draft)}
        disabled={busy}
        options={
          envelopeName(draft) === "cropped"
            ? [
                ...envelopes,
                { value: "cropped", label: "保留裁剪阶段", disabled: true },
              ]
            : envelopes
        }
        onChange={(value) =>
          setDraft({
            ...draft,
            progressStart: value === "fall" ? 0.5 : 0,
            progressEnd: value === "rise" ? 0.5 : 1,
          })
        }
      />
      {!valid && (
        <p role="alert" className="ve-field-error">
          开始时间与持续时间必须位于当前片段内。
        </p>
      )}
      {((effect.progressStart ?? 0) > 0 || (effect.progressEnd ?? 1) < 1) && (
        <p className="ve-field-help">
          此效果保留了裁剪前的变化阶段；调整时间不会重启变化。
        </p>
      )}
      <div className="ve-timed-effect-actions">
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() =>
            save({ ...draft, startUs: nextStart, durationUs: nextDuration })
          }
        >
          保存效果
        </button>
        <button
          type="button"
          aria-label={`删除片内效果 ${transitionLabel(effect.kind)}`}
          onClick={remove}
        >
          <Trash2 size={14} aria-hidden />
          删除
        </button>
      </div>
    </fieldset>
  );
}

export function VideoEditorTimedEffects({
  clip,
  playheadUs,
  disabled,
  commit,
}: {
  clip: VideoEditorClip;
  playheadUs: number;
  disabled: boolean;
  commit: Commit;
}) {
  const [kind, setKind] = useState<VideoEditorTimedEffect["kind"]>("flash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (clip.kind !== "video" && clip.kind !== "image") return null;
  const change = async (
    edit: (
      effects: VideoEditorTimedEffect[],
      current: VideoEditorClip,
    ) => VideoEditorTimedEffect[],
  ) => {
    setBusy(true);
    setError("");
    try {
      await commit((timeline) => {
        const current = timeline.document.tracks
          ?.flatMap((track) => track.clips ?? [])
          .find((item) => item.id === clip.id);
        if (!current) throw new Error("当前片段已不存在，请重新选择");
        const before = current.timedEffects ?? [];
        return {
          redo: [
            {
              type: "updateClip",
              clipId: clip.id,
              patch: { timedEffects: edit(before, current) },
            },
          ],
          undo: [
            {
              type: "updateClip",
              clipId: clip.id,
              patch: { timedEffects: before },
            },
          ],
        };
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "片内效果保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ve-inspector-section ve-timed-effects">
      <div className="ve-section-heading">
        <div>
          <h3>片内时间点效果</h3>
          <p>用于复合视频内部的闪光、甩镜与扫光</p>
        </div>
        <span>{clip.timedEffects?.length ?? 0}</span>
      </div>
      <p className="ve-field-help">
        时间从当前片段起点计，效果只影响当前画面，不改变播放速度或声音。
      </p>
      <CustomSelect
        ariaLabel="新增片内效果类型"
        value={kind}
        options={kindOptions}
        disabled={disabled || busy}
        onChange={(value) => setKind(value as VideoEditorTimedEffect["kind"])}
      />
      <button
        className="ve-timed-effect-add"
        type="button"
        disabled={disabled || busy || clip.durationUs < 1}
        onClick={() => {
          const id = crypto.randomUUID();
          void change((effects, current) => {
            const startUs = Math.max(
              0,
              Math.min(
                current.durationUs - 1,
                playheadUs - current.timelineStartUs,
              ),
            );
            return [
              ...effects,
              {
                id,
                kind,
                startUs,
                durationUs: Math.min(400_000, current.durationUs - startUs),
                direction: "left",
                easing: "linear",
                progressStart: 0,
                progressEnd: 1,
              },
            ];
          });
        }}
      >
        在播放头添加效果
      </button>
      {(clip.timedEffects ?? []).map((effect) => (
        <EffectFields
          key={`${clip.id}-${JSON.stringify(effect)}`}
          effect={effect}
          durationUs={clip.durationUs}
          busy={disabled || busy}
          save={(next) =>
            void change((effects) =>
              effects.map((item) => (item.id === effect.id ? next : item)),
            )
          }
          remove={() =>
            void change((effects) =>
              effects.filter((item) => item.id !== effect.id),
            )
          }
        />
      ))}
      {error && (
        <p className="ve-field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
