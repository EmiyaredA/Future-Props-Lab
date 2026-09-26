import { useEffect, useRef, useState, type ReactNode } from "react";
import { zipSync } from "fflate";
import { ApiError } from "@platform/api/client";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { Choice } from "./Controls";
import {
  attachCubism,
  createCubismCopy,
  downloadCubism,
  getCubism,
  preflightCubism,
  removeCubism,
  saveCubismBindings,
  type CubismAttachment,
} from "./api";
import { convertCubism, type ConversionResult } from "./cubismConversion";
import {
  CubismRuntime,
  type CubismMetadata,
  type CubismParameter,
} from "./cubismRuntime";
import type { CharacterDocument, Project } from "./types";
import "./cubism-workspace.css";

const STATES = [
  ["idle", "待命"],
  ["listening", "聆听"],
  ["thinking", "思考"],
  ["tool", "执行"],
  ["success", "完成"],
  ["error", "关注"],
  ["paused", "暂停"],
] as const;
type View = "fpl" | "cubism" | "split";

async function directoryZip(files: File[]): Promise<File> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    entries[path] = new Uint8Array(await file.arrayBuffer());
  }
  return new File([zipSync(entries)], "cubism-runtime.zip", {
    type: "application/zip",
  });
}

function CubismPreview({
  projectId,
  archive,
  metadata,
  motion,
  expression,
  loop,
}: {
  projectId: string;
  archive: Blob;
  metadata: CubismMetadata;
  motion: string;
  expression: string;
  loop: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<CubismRuntime | null>(null);
  const [error, setError] = useState("");
  const [parameters, setParameters] = useState<CubismParameter[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [camera, setCamera] = useState<"avatar" | "stage">("stage");
  const fallback = useApiBlobUrl(
    `/v1/live2d-workshop/projects/${encodeURIComponent(projectId)}/thumbnail`,
  );
  const controls = useRef({ camera, overrides });
  controls.current = { camera, overrides };
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let last = performance.now();
    let player: CubismRuntime | null = null;
    const node = canvas.current;
    if (!node) return;
    setError("");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const tick = (now: number) => {
      frame = 0;
      if (cancelled || !player || document.visibilityState !== "visible")
        return;
      try {
        player.draw(
          reduced.matches ? 0 : Math.min(0.05, (now - last) / 1000),
          controls.current.camera,
          controls.current.overrides,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Cubism 绘制失败");
        return;
      }
      last = now;
      if (!reduced.matches) frame = requestAnimationFrame(tick);
    };
    const resume = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (player && document.visibilityState === "visible") {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", resume);
    reduced.addEventListener("change", resume);
    void CubismRuntime.open(node, archive, metadata)
      .then((loaded) => {
        if (cancelled) {
          loaded.close();
          return;
        }
        player = loaded;
        runtime.current = loaded;
        setParameters(loaded.parameters());
        loaded.play(motion, expression, loop);
        resume();
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "Cubism 预览加载失败",
          );
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", resume);
      reduced.removeEventListener("change", resume);
      player?.close();
      runtime.current = null;
    };
    // The archive owns the SDK instance; control changes use the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive, metadata]);
  useEffect(
    () => runtime.current?.play(motion, expression, loop),
    [motion, expression, loop],
  );
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      runtime.current?.draw(0, camera, overrides);
  }, [camera, overrides]);
  return (
    <div className="l2-cubism-preview">
      <div className="l2-cubism-camera" role="group" aria-label="Cubism 相机位">
        <button
          aria-pressed={camera === "avatar"}
          onClick={() => setCamera("avatar")}
        >
          头像
        </button>
        <button
          aria-pressed={camera === "stage"}
          onClick={() => setCamera("stage")}
        >
          半身
        </button>
      </div>
      <canvas
        ref={canvas}
        width={480}
        height={640}
        aria-label="官方 Cubism SDK 运行预览"
      />
      {error && fallback.url && (
        <img
          className="l2-cubism-fallback"
          src={fallback.url}
          alt="WebGL 不可用时显示的 FPL 工程定帧"
        />
      )}
      {error && (
        <p role="alert" className="l2-error">
          {error}
        </p>
      )}
      {parameters.length > 0 && (
        <details className="l2-cubism-parameters">
          <summary>参数试调 · {parameters.length}</summary>
          {parameters.map((parameter) => (
            <label key={parameter.id} className="l2-cubism-parameter">
              <span>{parameter.id}</span>
              <input
                type="range"
                min={parameter.minimum}
                max={parameter.maximum}
                step={(parameter.maximum - parameter.minimum) / 100 || 0.01}
                value={overrides[parameter.id] ?? parameter.defaultValue}
                onChange={(event) =>
                  setOverrides((values) => ({
                    ...values,
                    [parameter.id]: Number(event.target.value),
                  }))
                }
              />
              <output>
                {(overrides[parameter.id] ?? parameter.defaultValue).toFixed(2)}
              </output>
            </label>
          ))}
        </details>
      )}
    </div>
  );
}

export function CubismWorkspace({
  projectId,
  revision,
  dirty,
  readOnly,
  enabled,
  template,
  onRevision,
  children,
}: {
  projectId: string;
  revision: number;
  dirty: boolean;
  readOnly: boolean;
  enabled: boolean;
  template: CharacterDocument;
  onRevision: (revision: number) => void;
  children: ReactNode;
}) {
  const [attachment, setAttachment] = useState<CubismAttachment | null>(null);
  const [archive, setArchive] = useState<Blob | null>(null);
  const [candidate, setCandidate] = useState<{
    file: File;
    metadata: CubismMetadata;
  } | null>(null);
  const [view, setView] = useState<View>("fpl");
  const [state, setState] = useState<(typeof STATES)[number][0]>("idle");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversion, setConversion] = useState<ConversionResult | null>(null);
  const [conversionSource, setConversionSource] = useState<Blob | null>(null);
  const [convertedProject, setConvertedProject] = useState<Project | null>(
    null,
  );
  const [previewUrl, setPreviewUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void getCubism(projectId)
      .then((value) => {
        if (live) setAttachment(value);
      })
      .catch((cause) => {
        if (live && (!(cause instanceof ApiError) || cause.status !== 404))
          setMessage(
            cause instanceof Error ? cause.message : "Cubism 附件读取失败",
          );
      });
    return () => {
      live = false;
    };
  }, [projectId, enabled]);
  useEffect(() => {
    if (!attachment || archive) return;
    let live = true;
    void downloadCubism(projectId)
      .then((value) => {
        if (live) setArchive(value);
      })
      .catch((cause) => {
        if (live) setMessage(String(cause));
      });
    return () => {
      live = false;
    };
  }, [projectId, attachment, archive]);
  useEffect(() => {
    if (!conversion?.preview) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(conversion.preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [conversion]);
  const inspect = async (files: File[], folder: boolean) => {
    if (!files.length) return;
    setBusy(true);
    setMessage("");
    try {
      const file = folder ? await directoryZip(files) : files[0];
      const metadata = await preflightCubism(projectId, file);
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const runtime = await CubismRuntime.open(canvas, file, metadata);
      runtime.draw(0, "stage", {});
      runtime.close();
      setCandidate({ file, metadata });
      setConversion(null);
      setConvertedProject(null);
      setView("cubism");
      setMessage(
        "文件与官方 SDK 加载检查通过。可挂载原样预览，或稍后生成新的 FPL 副本。",
      );
    } catch (cause) {
      setCandidate(null);
      setMessage(cause instanceof Error ? cause.message : "检查失败");
    } finally {
      setBusy(false);
    }
  };
  const convert = async () => {
    const source = candidate?.file ?? archive;
    const metadata = candidate?.metadata ?? attachment?.metadata;
    if (!source || !metadata) return;
    setBusy(true);
    setMessage("正在从官方 SDK 采样参数与绘制网格…");
    try {
      const result = await convertCubism(
        source,
        metadata,
        template,
        candidate ? {} : (attachment?.stateBindings ?? {}),
      );
      setConversion(result);
      setConversionSource(source);
      setConvertedProject(null);
      setView("split");
      setMessage(
        result.blockers.length
          ? "转换被容量或格式限制阻止；原始 Cubism 预览仍可使用。"
          : "请对照原版和 FPL 中性姿态，并检查损失报告，再创建副本。",
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "转换失败");
    } finally {
      setBusy(false);
    }
  };
  const createCopy = async () => {
    if (!conversion?.package || !conversionSource) return;
    setBusy(true);
    try {
      const project = await createCubismCopy(
        projectId,
        revision,
        conversion.package,
        conversionSource,
        candidate ? {} : (attachment?.stateBindings ?? {}),
      );
      setConvertedProject(project);
      setMessage("新的 FPL 可编辑副本已创建，源角色未被转换覆盖。");
    } catch (cause) {
      setMessage(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const attach = async () => {
    if (!candidate) return;
    setBusy(true);
    try {
      const value = await attachCubism(projectId, revision, candidate.file);
      setAttachment(value);
      setArchive(candidate.file);
      setCandidate(null);
      setView("cubism");
      onRevision(value.revision);
      setMessage("Cubism 运行包已挂载；原生工程保持可编辑。");
    } catch (cause) {
      setMessage(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const selected = attachment?.stateBindings[state] ?? {};
  const motionOptions = [
    { value: "", label: "无动作" },
    ...Object.entries(attachment?.metadata.motions ?? {}).flatMap(
      ([group, paths]) =>
        paths.map((path, index) => ({
          value: `${group}:${index}`,
          label: `${group} · ${path.split("/").pop()}`,
        })),
    ),
  ];
  const expressionOptions = [
    { value: "", label: "无表情" },
    ...(attachment?.metadata.expressions ?? []).map((item) => ({
      value: item.name,
      label: item.name,
    })),
  ];
  const updateBinding = async (
    field: "motion" | "expression",
    value: string,
  ) => {
    if (!attachment) return;
    const next = {
      ...attachment.stateBindings,
      [state]: { ...selected, [field]: value || undefined },
    };
    setBusy(true);
    try {
      const saved = await saveCubismBindings(projectId, revision, next);
      setAttachment(saved);
      onRevision(saved.revision);
      setMessage("状态映射已保存");
    } catch (cause) {
      setMessage(String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!enabled) return <>{children}</>;
  return (
    <div className="l2-cubism-workspace">
      <div className="l2-cubism-toolbar">
        <span>Cubism 对照</span>
        {(["fpl", "cubism", "split"] as const).map((item) => (
          <button
            key={item}
            disabled={!attachment && !candidate && item !== "fpl"}
            aria-pressed={view === item}
            onClick={() => setView(item)}
          >
            {item === "fpl" ? "FPL" : item === "cubism" ? "Cubism" : "并排"}
          </button>
        ))}
        {!readOnly && (
          <>
            <button
              disabled={dirty || busy}
              onClick={() => fileInput.current?.click()}
            >
              导入 ZIP
            </button>
            <button
              disabled={dirty || busy}
              onClick={() => dirInput.current?.click()}
            >
              导入文件夹
            </button>
          </>
        )}
        {!readOnly && (candidate || attachment) && (
          <button disabled={dirty || busy} onClick={() => void convert()}>
            尽力转换为新副本
          </button>
        )}
        {attachment && !candidate && (
          <button
            onClick={() => {
              void downloadCubism(projectId).then((blob) => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "cubism-runtime.zip";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              });
            }}
          >
            下载运行包
          </button>
        )}
        {attachment && !readOnly && (
          <button
            disabled={dirty || busy}
            onClick={() => {
              setBusy(true);
              void removeCubism(projectId, revision)
                .then(() => {
                  onRevision(revision + 1);
                  setAttachment(null);
                  setArchive(null);
                  setView("fpl");
                })
                .catch((cause) => setMessage(String(cause)))
                .finally(() => setBusy(false));
            }}
          >
            移除
          </button>
        )}
        <input
          hidden
          ref={fileInput}
          type="file"
          accept=".zip"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void inspect(files, false);
          }}
        />
        <input
          hidden
          ref={(node) => {
            dirInput.current = node;
            node?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void inspect(files, true);
          }}
        />
      </div>
      {dirty && (
        <p className="l2-cubism-message">
          请先保存 FPL 工程，再修改 Cubism 附件。
        </p>
      )}
      {message && (
        <p className="l2-cubism-message" role="status">
          {message}
        </p>
      )}
      {candidate && (
        <div className="l2-cubism-preflight">
          <strong>导入检查 · {candidate.metadata.fileCount} 个文件</strong>
          <span>
            {candidate.metadata.modelPath} ·{" "}
            {candidate.metadata.textures.length} 张贴图 ·{" "}
            {Object.values(candidate.metadata.motions).flat().length} 个动作
          </span>
          <button disabled={dirty || busy} onClick={() => void attach()}>
            挂载并原样预览
          </button>
        </div>
      )}
      {conversion && (
        <div
          className="l2-cubism-report"
          role="region"
          aria-label="Cubism 转换损失报告"
        >
          <strong>
            转换报告 · {conversion.parts} 个绘制部件 · {conversion.parameters}{" "}
            个参数
          </strong>
          {[...conversion.blockers, ...conversion.report].map(
            (issue, index) => (
              <p key={`${index}:${issue}`}>{issue}</p>
            ),
          )}
          {conversion.package && !convertedProject && (
            <button disabled={busy || dirty} onClick={() => void createCopy()}>
              确认并创建可编辑副本
            </button>
          )}
          {convertedProject && (
            <a
              href={`/apps/live2d-workshop/projects/${encodeURIComponent(convertedProject.id)}/editor`}
            >
              打开转换副本
            </a>
          )}
        </div>
      )}
      {attachment && (
        <div className="l2-cubism-statebar">
          <div role="group" aria-label="Cubism 执行状态">
            {STATES.map(([key, label]) => (
              <button
                key={key}
                aria-pressed={state === key}
                onClick={() => setState(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <Choice
            label="动作"
            value={selected.motion ?? ""}
            options={motionOptions}
            disabled={readOnly || dirty || busy}
            onChange={(value) => void updateBinding("motion", value)}
          />
          <Choice
            label="表情"
            value={selected.expression ?? ""}
            options={expressionOptions}
            disabled={readOnly || dirty || busy}
            onChange={(value) => void updateBinding("expression", value)}
          />
        </div>
      )}
      <div className={`l2-cubism-views ${view === "split" ? "split" : ""}`}>
        {view !== "cubism" &&
          (previewUrl ? (
            <div className="l2-cubism-converted">
              <span>FPL 转换预览 · 中性姿态</span>
              <img src={previewUrl} alt="FPL 转换后的中性姿态" />
            </div>
          ) : (
            children
          ))}
        {view !== "fpl" &&
          (candidate?.file ?? archive) &&
          (candidate?.metadata ?? attachment?.metadata) && (
            <CubismPreview
              projectId={projectId}
              archive={(candidate?.file ?? archive)!}
              metadata={(candidate?.metadata ?? attachment?.metadata)!}
              motion={selected.motion ?? ""}
              expression={selected.expression ?? ""}
              loop={
                !(["success", "error", "paused"] as string[]).includes(state)
              }
            />
          )}
      </div>
    </div>
  );
}
