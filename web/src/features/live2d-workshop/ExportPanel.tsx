import { useEffect, useRef, useState } from "react";
import { Check, Download, Square } from "lucide-react";
import {
  cancelExport,
  createExport,
  download,
  downloadProject,
  listExports,
  preflight,
} from "./api";
import { Choice, Numeric } from "./Controls";
import { ExportPreview } from "./ExportPreview";
import { buildCubismHandoff, saveHandoff } from "./psdHandoff";
import {
  defaultEnd,
  exportCrop,
  outputSize,
  type Crop,
  type CropMode,
} from "./exportSettings";
import type { CharacterDocument, ExportRequest, ExportTask } from "./types";
import "./export.css";
export function ExportPanel({
  doc,
  projectId,
  save,
  readOnly,
  dirty,
  revision,
}: {
  doc: CharacterDocument;
  projectId: string;
  save: () => Promise<number>;
  readOnly: boolean;
  dirty: boolean;
  revision: number;
}) {
  const [tasks, setTasks] = useState<ExportTask[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [expressions, setExpressions] = useState<string[]>([""]),
    [motions, setMotions] = useState<string[]>([""]);
  const [cropMode, setCropMode] = useState<CropMode>("full"),
    [custom, setCustom] = useState<Crop>({
      x: 0,
      y: 0,
      width: doc.width,
      height: doc.height,
    });
  const crop = exportCrop(doc, cropMode, custom);
  const [size, setSize] = useState(() => outputSize(512, crop)),
    [locked, setLocked] = useState(true);
  const { width, height } = locked ? outputSize(size.width, crop) : size;
  const [fps, setFps] = useState(30),
    [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const start = range?.start ?? 0,
    end = range?.end ?? defaultEnd(doc, motions, fps);
  const [previewFrame, setPreviewFrame] = useState(0),
    [expression, setExpression] = useState(""),
    [motion, setMotion] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const currentDoc = useRef(doc);
  currentDoc.current = doc;
  const activeTasks = tasks.some(
    (t) => t.status === "queued" || t.status === "running",
  );
  useEffect(() => {
    let live = true;
    listExports(projectId)
      .then((r) => {
        if (live) setTasks(r.items);
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, [projectId, refresh]);
  useEffect(() => {
    if (!activeTasks) return;
    const timer = setInterval(() => setRefresh((v) => v + 1), 1500);
    return () => clearInterval(timer);
  }, [activeTasks]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };
  const saveSnapshot = async () => {
    const version = await save();
    if (currentDoc.current !== doc)
      throw new Error("保存期间工程发生变化，请重新保存并检查预览");
    return version;
  };
  const combinations = expressions.flatMap((expressionId) =>
    motions.map((motionId) => ({
      expressionId: expressionId || null,
      motionId: motionId || null,
    })),
  );
  const submit = (onlyCheck = false) =>
    run(async () => {
      const expectedRevision = await saveSnapshot();
      const body: ExportRequest = {
        expectedRevision,
        requestId: crypto.randomUUID(),
        width,
        height,
        fps,
        startFrame: start,
        endFrame: end,
        combinations,
        crop: cropMode === "full" ? null : crop,
      };
      const check = await preflight(projectId, body);
      setMessage(check.messages.join("；"));
      if (check.ready && !onlyCheck) {
        await createExport(projectId, body);
        setRefresh((v) => v + 1);
      }
    });
  const toggle = (set: (v: string[]) => void, list: string[], id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <section className="l2-export">
      <header>
        <h2>导出与结果检查</h2>
        <p>
          {dirty
            ? "有未保存修改 · 请保存并更新预览"
            : `已保存快照 revision ${revision} · 预览与导出使用相同版本`}
        </p>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await saveSnapshot();
              setMessage("预览已更新到已保存版本");
            })
          }
        >
          保存并更新预览
        </button>
      </header>
      <div className="l2-export-grid">
        <article>
          <h3>透明 PNG 序列</h3>
          <Choice
            label="裁切方式"
            value={cropMode}
            onChange={(v) => setCropMode(v as CropMode)}
            options={[
              { value: "full", label: "完整画布" },
              { value: "square", label: "居中方形头像裁切" },
              { value: "custom", label: "自定义裁切" },
            ]}
          />
          {cropMode === "custom" && (
            <div className="l2-two">
              {(["x", "y", "width", "height"] as const).map((key) => (
                <Numeric
                  key={key}
                  label={
                    {
                      x: "裁切 X",
                      y: "裁切 Y",
                      width: "裁切宽度",
                      height: "裁切高度",
                    }[key]
                  }
                  value={crop[key]}
                  min={key === "x" || key === "y" ? 0 : 1}
                  max={
                    key === "x"
                      ? doc.width - crop.width
                      : key === "y"
                        ? doc.height - crop.height
                        : key === "width"
                          ? doc.width - crop.x
                          : doc.height - crop.y
                  }
                  onChange={(v) => setCustom({ ...crop, [key]: v })}
                />
              ))}
            </div>
          )}
          <div className="l2-two">
            <Numeric
              label="宽度"
              value={width}
              min={32}
              max={2048}
              onChange={(v) =>
                setSize(
                  locked
                    ? outputSize(v, crop)
                    : { width: Math.round(v), height },
                )
              }
            />
            <Numeric
              label="高度"
              value={height}
              min={32}
              max={2048}
              onChange={(v) =>
                setSize(
                  locked
                    ? outputSize((v * crop.width) / crop.height, crop)
                    : { width, height: Math.round(v) },
                )
              }
            />
            <Numeric
              label="帧率"
              value={fps}
              min={1}
              max={60}
              onChange={(v) => setFps(Math.round(v))}
            />
            <Numeric
              label="起始帧"
              value={start}
              min={0}
              max={end - 1}
              onChange={(v) => setRange({ start: Math.round(v), end })}
            />
            <Numeric
              label="结束帧（不含）"
              value={end}
              min={start + 1}
              max={3600}
              onChange={(v) => setRange({ start, end: Math.round(v) })}
            />
          </div>
          <label className="l2-check">
            <input
              type="checkbox"
              checked={locked}
              onChange={(e) => {
                setSize({ width, height });
                setLocked(e.target.checked);
              }}
            />
            保持裁切宽高比
          </label>
          <label className="l2-check">
            <input
              type="checkbox"
              checked={!range}
              onChange={(e) =>
                setRange(e.target.checked ? null : { start, end })
              }
            />
            自动帧范围（多个动作取共同有效时长，静态输出一帧）
          </label>
          <h4>表情</h4>
          <div className="l2-chips">
            {[{ id: "", name: "默认" }, ...doc.expressions].map((e) => (
              <button
                key={e.id}
                aria-pressed={expressions.includes(e.id)}
                onClick={() => {
                  toggle(setExpressions, expressions, e.id);
                  setExpression(e.id);
                }}
              >
                {expressions.includes(e.id) && <Check size={12} />}
                {e.name}
              </button>
            ))}
          </div>
          <h4>动作</h4>
          <div className="l2-chips">
            {[{ id: "", name: "静态" }, ...doc.motions].map((m) => (
              <button
                key={m.id}
                aria-pressed={motions.includes(m.id)}
                onClick={() => {
                  toggle(setMotions, motions, m.id);
                  setMotion(m.id);
                }}
              >
                {motions.includes(m.id) && <Check size={12} />}
                {m.name}
              </button>
            ))}
          </div>
          <p>
            {combinations.length} 个组合 · 共{" "}
            {(end - start) * combinations.length} 帧 · 每个组合独立目录
          </p>
          <ul>
            {combinations.map((c) => (
              <li key={`${c.expressionId}/${c.motionId}`}>
                {doc.expressions.find((e) => e.id === c.expressionId)?.name ??
                  "默认"}{" "}
                ＋{" "}
                {doc.motions.find((m) => m.id === c.motionId)?.name ?? "静态"} ·{" "}
                {end - start} 帧
              </li>
            ))}
          </ul>
          <div className="l2-actions">
            <button
              disabled={busy || !combinations.length}
              onClick={() => void submit(true)}
            >
              兼容与范围检查
            </button>
            <button
              className="l2-primary"
              disabled={busy || readOnly || !combinations.length}
              onClick={() => void submit()}
            >
              <Download size={16} />
              导出序列
            </button>
          </div>
        </article>
        <ExportPreview
          projectId={projectId}
          doc={doc}
          revision={dirty ? null : revision}
          expression={expression}
          motion={motion}
          frame={Math.max(start, Math.min(end - 1, previewFrame))}
          fps={fps}
          width={width}
          height={height}
          crop={crop}
          custom={cropMode === "custom"}
          onCrop={setCustom}
          onFrame={setPreviewFrame}
          onExpression={setExpression}
          onMotion={setMotion}
          start={start}
          end={end}
        />
        <article>
          <h3>可编辑工程</h3>
          <p>.fpllive2d · 文档、素材与缩略图</p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await saveSnapshot();
                await downloadProject(projectId);
              })
            }
          >
            <Download size={16} />
            下载工程包
          </button>
          <h3>Cubism 素材交接</h3>
          <p>
            导出分层 PSD、逐层 PNG、可映射的动作与表情 JSON。导入 Cubism Editor
            后仍需重新制作网格和参数绑定。
          </p>
          <button
            disabled={busy || !doc.parts.length}
            onClick={() =>
              void run(async () => {
                await saveSnapshot();
                const { blob, warnings } = await buildCubismHandoff(
                  projectId,
                  doc,
                );
                if (currentDoc.current !== doc)
                  throw new Error("工程在导出期间发生变化，请重新导出");
                saveHandoff(blob, "character-cubism-handoff.zip");
                setMessage(
                  `交接包已生成；其中不包含可运行的 Cubism 模型${warnings.length ? `。${warnings.length} 个参数预设未交换，详见包内 README：${warnings.join("；")}` : ""}`,
                );
              })
            }
          >
            <Download size={16} />
            下载素材交接包
          </button>
          <p className="l2-hint">
            完整运行模型 `.moc3` 与可编辑工程 `.cmo3` 需由 Cubism Editor 生成。
          </p>
        </article>
      </div>
      {message && (
        <p role="status" className="l2-notice">
          {message}
        </p>
      )}
      <h3>导出记录</h3>
      <button disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
        刷新记录
      </button>
      {tasks.map((task) => (
        <div className="l2-task" key={task.id}>
          <span>
            {
              {
                queued: "排队中",
                running: "生成中",
                completed: "已完成",
                cancelled: "已取消",
                failed: "失败",
              }[task.status]
            }{" "}
            · {task.progress}%
          </span>
          <span>
            revision {task.settings.expectedRevision} · {task.settings.width} ×{" "}
            {task.settings.height} · {task.settings.fps} fps ·{" "}
            {task.settings.startFrame}–{task.settings.endFrame} 帧 ·{" "}
            {task.settings.combinations.length} 个组合
          </span>
          <details>
            <summary>组合与裁切参数</summary>
            <pre>
              {JSON.stringify(
                {
                  combinations: task.settings.combinations,
                  crop: task.settings.crop,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <progress value={task.progress} max={100} />
          {task.error && <span role="alert">{task.error}</span>}
          {task.download && (
            <button
              onClick={() =>
                void run(() => download(task.download!, "character-frames.zip"))
              }
            >
              <Download size={14} />
              下载 ZIP
            </button>
          )}
          {!readOnly && ["queued", "running"].includes(task.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await cancelExport(projectId, task.id);
                  setRefresh((v) => v + 1);
                })
              }
            >
              <Square size={13} />
              取消
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
