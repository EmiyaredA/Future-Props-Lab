import { useState } from "react";
import { Copy, Pause, Play, Plus, Trash2 } from "lucide-react";
import { Choice, Numeric } from "./Controls";
import { id, newMotion } from "./model";
import { InterchangePanel } from "./InterchangePanel";
import type { Edit } from "./Inspector";
import type { CharacterDocument, TimeKey } from "./types";
export function AnimationLibrary({
  doc,
  edit,
  motionId,
  setMotion,
  expressionId,
  setExpression,
  onPreviewState,
  values,
  overrides,
  setOverrides,
  readOnly,
}: {
  doc: CharacterDocument;
  edit: Edit;
  motionId: string;
  setMotion: (id: string) => void;
  expressionId: string;
  setExpression: (id: string) => void;
  onPreviewState?: (
    state:
      | "idle"
      | "listening"
      | "thinking"
      | "tool"
      | "success"
      | "error"
      | "paused",
  ) => void;
  values: Record<string, number>;
  overrides: Record<string, number>;
  setOverrides: (v: Record<string, number>) => void;
  readOnly: boolean;
}) {
  const expression = doc.expressions.find((e) => e.id === expressionId),
    motion = doc.motions.find((m) => m.id === motionId);
  return (
    <>
      <div className="l2-panel-heading">
        <h2>表情与动作</h2>
      </div>
      <Choice
        label="表情预设"
        value={expressionId}
        options={[
          { value: "", label: "默认表情" },
          ...doc.expressions.map((e) => ({ value: e.id, label: e.name })),
        ]}
        onChange={(v) => {
          setExpression(v);
          setOverrides({});
        }}
      />
      {expression && (
        <label className="l2-field">
          表情名称
          <input
            disabled={readOnly}
            value={expression.name}
            onChange={(e) =>
              edit((d) => {
                d.expressions.find((x) => x.id === expressionId)!.name =
                  e.target.value;
              })
            }
          />
        </label>
      )}
      <div className="l2-tree-actions">
        <button
          disabled={readOnly}
          onClick={() =>
            edit((d) => {
              const eid = id();
              d.expressions.push({
                id: eid,
                name: `表情 ${d.expressions.length + 1}`,
                values: { ...values },
              });
              setExpression(eid);
            })
          }
        >
          <Plus size={14} />
          保存为表情
        </button>
        {expression && (
          <button
            disabled={readOnly}
            onClick={() =>
              edit((d) => {
                d.expressions.find((e) => e.id === expressionId)!.values = {
                  ...values,
                };
              })
            }
          >
            更新
          </button>
        )}
      </div>
      <Choice
        label="动作"
        value={motionId}
        options={[
          { value: "", label: "静态姿态" },
          ...doc.motions.map((m) => ({ value: m.id, label: m.name })),
        ]}
        onChange={(v) => {
          setMotion(v);
          setOverrides({});
        }}
      />
      {motion && (
        <label className="l2-field">
          动作名称
          <input
            disabled={readOnly}
            value={motion.name}
            onChange={(e) =>
              edit((d) => {
                d.motions.find((m) => m.id === motionId)!.name = e.target.value;
              })
            }
          />
        </label>
      )}
      <button
        className="l2-full"
        disabled={readOnly}
        onClick={() =>
          edit((d) => {
            const m = newMotion(`动作 ${d.motions.length + 1}`);
            d.motions.push(m);
            setMotion(m.id);
          })
        }
      >
        <Plus size={14} />
        新建动作
      </button>
      <details>
        <summary>管理预设</summary>
        <button
          disabled={readOnly || !expression}
          onClick={() =>
            edit((d) => {
              d.expressions = d.expressions.filter(
                (e) => e.id !== expressionId,
              );
              for (const binding of Object.values(d.stateBindings))
                if (binding?.expressionId === expressionId)
                  binding.expressionId = null;
              setExpression("");
            })
          }
        >
          <Trash2 size={13} />
          删除表情
        </button>
        <button
          disabled={readOnly || !motion}
          onClick={() =>
            edit((d) => {
              d.motions = d.motions.filter((m) => m.id !== motionId);
              for (const binding of Object.values(d.stateBindings))
                if (binding?.motionId === motionId) binding.motionId = null;
              setMotion("");
            })
          }
        >
          <Trash2 size={13} />
          删除动作
        </button>
      </details>
      <hr />
      <strong>参数预览</strong>
      <p className="l2-hint">
        表情先设定参数；动作轨道覆盖同名参数。手动调整后可记录时间关键帧。
      </p>
      {doc.parameters.map((p) => (
        <label className="l2-parameter" key={p.id}>
          <span>
            {p.name}
            <small>{(values[p.id] ?? p.default).toFixed(2)}</small>
          </span>
          <input
            aria-label={`${p.name}动画值`}
            type="range"
            min={p.minimum}
            max={p.maximum}
            step={(p.maximum - p.minimum) / 100}
            value={values[p.id] ?? p.default}
            onChange={(e) =>
              setOverrides({ ...overrides, [p.id]: Number(e.target.value) })
            }
          />
        </label>
      ))}
      <button className="l2-full" onClick={() => setOverrides({})}>
        清除手动预览值
      </button>
      <InterchangePanel
        doc={doc}
        edit={edit}
        motionId={motionId}
        expressionId={expressionId}
        setMotion={setMotion}
        setExpression={setExpression}
        onPreviewState={onPreviewState}
        readOnly={readOnly}
      />
    </>
  );
}
export function AnimationTimeline({
  doc,
  motionId,
  frame,
  setFrame,
  playing,
  setPlaying,
  values,
  edit,
  readOnly,
}: {
  doc: CharacterDocument;
  motionId: string;
  frame: number;
  setFrame: (n: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  values: Record<string, number>;
  edit: Edit;
  readOnly: boolean;
}) {
  const motion = doc.motions.find((m) => m.id === motionId);
  const [parameterId, setParameter] = useState("ParamAngleY"),
    [copyKey, setCopyKey] = useState<TimeKey | null>(null);
  const track = motion?.tracks.find((t) => t.parameterId === parameterId),
    selectedKey = track?.keys.find((k) => k.frame === frame);
  const parameter =
    doc.parameters.find((p) => p.id === parameterId) ?? doc.parameters[0];
  const put = (key: TimeKey) =>
    edit((d) => {
      const m = d.motions.find((x) => x.id === motionId)!;
      let t = m.tracks.find((x) => x.parameterId === parameter.id);
      if (!t) {
        t = { parameterId: parameter.id, keys: [] };
        m.tracks.push(t);
      }
      t.keys = t.keys
        .filter((k) => k.frame !== key.frame)
        .concat([key])
        .sort((a, b) => a.frame - b.frame);
    });
  if (!motion)
    return (
      <div className="l2-timeline l2-hint">
        新建或选择动作后，记录参数的时间关键帧。
      </div>
    );
  return (
    <section className="l2-timeline">
      <div className="l2-timeline-toolbar">
        <button
          aria-label={playing ? "暂停" : "播放"}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <strong>{motion.name}</strong>
        <span>
          {(frame / motion.fps).toFixed(2)} s /{" "}
          {(motion.duration / motion.fps).toFixed(2)} s
        </span>
        <Numeric
          label="当前帧"
          value={frame}
          min={0}
          max={motion.duration}
          onChange={(v) => setFrame(Math.round(v))}
        />
        <Numeric
          label="帧率"
          value={motion.fps}
          min={1}
          max={60}
          disabled={readOnly}
          onChange={(v) =>
            edit((d) => {
              d.motions.find((m) => m.id === motionId)!.fps = Math.round(v);
            })
          }
        />
        <Numeric
          label="时长（帧）"
          value={motion.duration}
          min={1}
          max={36000}
          disabled={readOnly}
          onChange={(v) =>
            edit((d) => {
              const m = d.motions.find((m) => m.id === motionId)!;
              m.duration = Math.max(
                Math.round(v),
                ...m.tracks.flatMap((t) => t.keys.map((k) => k.frame)),
                1,
              );
              m.loopEnd = Math.min(m.loopEnd, m.duration);
              m.loopStart = Math.min(m.loopStart, m.loopEnd - 1);
            })
          }
        />
      </div>
      <input
        aria-label="时间播放头"
        className="l2-playhead"
        type="range"
        min={0}
        max={motion.duration}
        value={frame}
        onChange={(e) => {
          setPlaying(false);
          setFrame(Number(e.target.value));
        }}
      />
      <div className="l2-track-list">
        <div className="l2-track-ruler">
          <span>参数轨道</span>
          <div>
            {Array.from({ length: 6 }, (_, i) => (
              <small key={i}>
                {((i * motion.duration) / motion.fps / 5).toFixed(1)}s
              </small>
            ))}
          </div>
        </div>
        {doc.parameters.map((p) => (
          <div
            className={`l2-track ${parameterId === p.id ? "selected" : ""}`}
            key={p.id}
          >
            <button onClick={() => setParameter(p.id)}>{p.name}</button>
            <div
              className="l2-track-lane"
              onDoubleClick={(e) => {
                if (readOnly) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const at = Math.round(
                  ((e.clientX - rect.left) / rect.width) * motion.duration,
                );
                setParameter(p.id);
                setFrame(at);
              }}
            >
              <i style={{ left: `${(frame / motion.duration) * 100}%` }} />
              {motion.tracks
                .find((t) => t.parameterId === p.id)
                ?.keys.map((k) => (
                  <button
                    key={k.frame}
                    className="l2-time-key"
                    aria-label={`${p.name}第${k.frame}帧`}
                    draggable={!readOnly}
                    style={{ left: `${(k.frame / motion.duration) * 100}%` }}
                    onClick={() => {
                      setParameter(p.id);
                      setFrame(k.frame);
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "text/plain",
                        JSON.stringify({ parameterId: p.id, frame: k.frame }),
                      );
                    }}
                    onDragEnd={(e) => {
                      if (readOnly || e.clientX === 0) return;
                      const rect =
                        e.currentTarget.parentElement!.getBoundingClientRect();
                      const at = Math.max(
                        0,
                        Math.min(
                          motion.duration,
                          Math.round(
                            ((e.clientX - rect.left) / rect.width) *
                              motion.duration,
                          ),
                        ),
                      );
                      edit((d) => {
                        const t = d.motions
                          .find((m) => m.id === motionId)!
                          .tracks.find((t) => t.parameterId === p.id)!;
                        t.keys = t.keys
                          .filter((x) => x.frame !== k.frame && x.frame !== at)
                          .concat([{ ...k, frame: at }])
                          .sort((a, b) => a.frame - b.frame);
                      });
                      setFrame(at);
                    }}
                  >
                    ◆
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="l2-key-editor">
        <Choice
          label="编辑轨道"
          value={parameter.id}
          options={doc.parameters.map((p) => ({ value: p.id, label: p.name }))}
          onChange={setParameter}
        />
        <button
          disabled={readOnly}
          onClick={() =>
            put({ frame, value: values[parameter.id], interpolation: "linear" })
          }
        >
          <Plus size={14} />
          记录关键帧
        </button>
        <button
          aria-label="复制关键帧"
          disabled={!selectedKey}
          onClick={() => setCopyKey(selectedKey!)}
        >
          <Copy size={14} />
        </button>
        <button
          disabled={readOnly || !copyKey}
          onClick={() => {
            if (copyKey)
              put({
                ...copyKey,
                frame,
                value: Math.max(
                  parameter.minimum,
                  Math.min(parameter.maximum, copyKey.value),
                ),
              });
          }}
        >
          粘贴
        </button>
        <button
          aria-label="删除关键帧"
          disabled={readOnly || !selectedKey}
          onClick={() =>
            edit((d) => {
              const t = d.motions
                .find((m) => m.id === motionId)!
                .tracks.find((t) => t.parameterId === parameter.id)!;
              t.keys = t.keys.filter((k) => k.frame !== frame);
            })
          }
        >
          <Trash2 size={14} />
        </button>
        {selectedKey && (
          <>
            <Numeric
              label="关键帧数值"
              min={parameter.minimum}
              max={parameter.maximum}
              value={selectedKey.value}
              disabled={readOnly}
              onChange={(v) => put({ ...selectedKey, value: v })}
            />
            <Choice
              label="插值"
              value={selectedKey.interpolation}
              disabled={readOnly}
              options={[
                { value: "hold", label: "保持" },
                { value: "linear", label: "线性" },
                { value: "smooth", label: "缓入缓出" },
              ]}
              onChange={(v) =>
                put({
                  ...selectedKey,
                  interpolation: v as TimeKey["interpolation"],
                })
              }
            />
          </>
        )}
      </div>
      <div className="l2-loop">
        <Numeric
          label="循环起点"
          value={motion.loopStart}
          min={0}
          max={motion.loopEnd - 1}
          disabled={readOnly}
          onChange={(v) =>
            edit((d) => {
              d.motions.find((m) => m.id === motionId)!.loopStart =
                Math.round(v);
            })
          }
        />
        <Numeric
          label="循环终点"
          value={motion.loopEnd}
          min={motion.loopStart + 1}
          max={motion.duration}
          disabled={readOnly}
          onChange={(v) =>
            edit((d) => {
              d.motions.find((m) => m.id === motionId)!.loopEnd = Math.round(v);
            })
          }
        />
        <svg aria-label="参数曲线预览" viewBox="0 0 300 60">
          <path d="M0 55H300M0 5V55" stroke="#526078" fill="none" />
          <path
            stroke="#ae90ff"
            strokeWidth="2"
            fill="none"
            d={(track?.keys ?? [])
              .map((k, i, a) => {
                const x = (k.frame / motion.duration) * 300,
                  y =
                    55 -
                    ((k.value - parameter.minimum) /
                      (parameter.maximum - parameter.minimum)) *
                      50;
                if (i === 0) return `M${x} ${y}`;
                const prev = a[i - 1],
                  px = (prev.frame / motion.duration) * 300,
                  py =
                    55 -
                    ((prev.value - parameter.minimum) /
                      (parameter.maximum - parameter.minimum)) *
                      50;
                return prev.interpolation === "hold"
                  ? `H${x}V${y}`
                  : prev.interpolation === "smooth"
                    ? `C${px + (x - px) / 3} ${py} ${x - (x - px) / 3} ${y} ${x} ${y}`
                    : `L${x} ${y}`;
              })
              .join(" ")}
          />
        </svg>
      </div>
    </section>
  );
}
