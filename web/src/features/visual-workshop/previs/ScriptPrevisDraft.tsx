import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clapperboard,
  FileText,
  Play,
  Plus,
  ScanText,
  Sparkles,
  X,
} from "lucide-react";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { apiErrorMessage } from "@platform/api/errors";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { createSceneDocument } from "../../../../vendor/toonflow/trumanScene";
import {
  mountTrumanMap,
  scriptSetOptions,
  type SceneDocument,
  type TrumanHostProps,
} from "../../../../vendor/toonflow/trumanHost";
import { getScript, scriptKey, type ScriptSeed } from "../creative/api";
import {
  analyzeScript,
  analyzeWithRules,
  scriptText,
  type ScriptAnalysis,
} from "../creative/scriptAnalysis";
import { TextModelSelect } from "../creative/TextModelSelect";
import { createPrevis, type PrevisScene } from "./api";
import "../creative/creative.css";
import "./script-previs-draft.css";

function transcriptFromAnalysis(raw: string, result: ScriptAnalysis) {
  const heading = [result.location, result.time].filter(Boolean).join(" · ");
  const ordered = [
    ...result.dialogue.map(({ speaker, line }) => ({
      offset: raw.indexOf(line),
      text: `${speaker}：${line}`,
    })),
    ...result.actions.map(({ quote }) => ({
      offset: raw.indexOf(quote),
      text: quote,
    })),
  ].sort((a, b) => a.offset - b.offset);
  return (
    [heading, ...ordered.map((entry) => entry.text)]
      .filter(Boolean)
      .join("\n") || raw
  );
}

export default function ScriptPrevisDraft({
  project,
  suspended = false,
  creationDisabled = false,
  previewContainer,
  onPreviewChange,
  seed,
  onCreated,
  onCancel,
  onBusy,
}: {
  project: string;
  suspended?: boolean;
  creationDisabled?: boolean;
  previewContainer?: HTMLElement | null;
  onPreviewChange?: (visible: boolean) => void;
  seed?: ScriptSeed;
  onCreated: (scene: PrevisScene) => void;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const canUseModels = useAccountPermission("models.use");
  const [mode, setMode] = useState<"script" | "paste">(
    seed ? "script" : "paste",
  );
  const [chosen, setChosen] = useState(seed?.scene.id ?? "");
  const [paste, setPaste] = useState("");
  const [title, setTitle] = useState(seed?.scene.title ?? "");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScriptAnalysis>();
  const [template, setTemplate] = useState("");
  const [transcript, setTranscript] = useState("");
  const [analyzedInput, setAnalyzedInput] = useState<{
    raw: string;
    source?: ScriptSeed["source"];
  }>();
  const [preview, setPreview] = useState<{
    document: SceneDocument;
    shots: string[];
    characters: string[];
    notice?: string;
  }>();
  const abort = useRef<AbortController>(null);
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<ReturnType<typeof mountTrumanMap>>(null);
  const previewSnapshot = useRef(preview);
  previewSnapshot.current = preview;
  useLayoutEffect(() => {
    if (suspended) {
      host.current?.dispose();
      host.current = null;
    } else if (root.current && !host.current && previewSnapshot.current) {
      host.current = mountTrumanMap(root.current, {
        document: previewSnapshot.current.document,
        readOnly: true,
        saving: false,
        statusMessage: "",
        error: "",
        onChange() {},
        onSave() {},
        onClose() {},
      });
    }
  }, [suspended]);
  const script = useQuery({
    queryKey: scriptKey(project),
    queryFn: ({ signal }) => getScript(project, signal),
    enabled: mode === "script",
  });
  const scenes =
    script.data?.episodes.flatMap((episode) =>
      episode.scenes.map((scene) => ({
        scene,
        label: `${episode.title} / ${scene.title}`,
      })),
    ) ?? [];
  const selected =
    scenes.find((entry) => entry.scene.id === chosen)?.scene ??
    (seed?.scene.id === chosen ? seed.scene : undefined);
  const raw = mode === "script" && selected ? scriptText(selected) : paste;
  const source =
    mode === "script" && selected && script.data
      ? { scene_id: selected.id, revision: script.data.revision }
      : undefined;

  useEffect(
    () => () => {
      abort.current?.abort();
      host.current?.dispose();
    },
    [],
  );

  function invalidate() {
    host.current?.dispose();
    host.current = null;
    onPreviewChange?.(false);
    setResult(undefined);
    setPreview(undefined);
    setError("");
  }

  async function build(text: string, setId: string) {
    if (!root.current) return;
    host.current?.dispose();
    onPreviewChange?.(true);
    setPreview(undefined);
    let document = createSceneDocument();
    const props: TrumanHostProps = {
      document,
      readOnly: false,
      saving: false,
      statusMessage: "",
      error: "",
      onSave() {},
      onClose() {},
      onChange(next) {
        document = next;
        instance.update({ ...props, document });
      },
    };
    const instance = mountTrumanMap(root.current, props);
    host.current = instance;
    let result;
    try {
      result = await instance.buildScript(text, setId);
    } catch (failure) {
      instance.dispose();
      if (host.current === instance) host.current = null;
      onPreviewChange?.(false);
      throw failure;
    }
    if (host.current !== instance) return;
    instance.update({ ...props, document, readOnly: true });
    setPreview({
      document,
      shots: result.shots.map((shot) => shot.camera.replace(/^分镜·/, "")),
      characters: result.characters,
      notice: result.notice,
    });
  }

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  function analyze(useAI: boolean) {
    void run(async () => {
      invalidate();
      const controller = new AbortController();
      abort.current = controller;
      const next = useAI
        ? await analyzeScript(raw.trim(), model, controller.signal)
        : analyzeWithRules(raw.trim());
      controller.signal.throwIfAborted();
      const normalized = useAI ? transcriptFromAnalysis(raw, next) : raw;
      const choice = scriptSetOptions(normalized).suggested;
      const preferred =
        choice || (/咖啡|室内|内景/.test(normalized) ? "conversation" : "");
      setResult(next);
      setAnalyzedInput({ raw, source });
      setTranscript(normalized);
      setTemplate(preferred);
      await build(normalized, preferred);
    });
  }

  const currentPreview =
    analyzedInput?.raw === raw &&
    analyzedInput?.source?.scene_id === source?.scene_id &&
    analyzedInput?.source?.revision === source?.revision;
  const characters = preview?.characters.length
    ? preview.characters
    : (result?.characters.map((entry) => entry.name) ?? []);
  const lineCount = raw.split(/\r?\n/).filter((line) => line.trim()).length;
  const locationSummary = result
    ? [
        result.location,
        result.time && !result.location.includes(result.time)
          ? result.time
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div
      className={`creative-window script-previs-draft${previewContainer ? " is-docked" : ""}`}
      role="region"
      aria-label="从剧本创建预演"
    >
      <header className="creative-toolbar">
        <div className="script-previs-heading">
          <FileText size={17} aria-hidden />
          <strong>从剧本创建预演</strong>
        </div>
        <button
          type="button"
          className="creative-quiet"
          aria-label="关闭剧本预演"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={17} />
        </button>
      </header>
      <div className="script-previs-columns">
        {creationDisabled && (
          <p className="creative-feedback" role="status">
            请扩大窗口以创建场景，当前输入已保留。
          </p>
        )}
        <div className="script-previs-inputs">
          <div
            className="visual-project-view-toggle"
            role="group"
            aria-label="剧本来源"
          >
            {(["script", "paste"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className={mode === entry ? "active" : undefined}
                aria-pressed={mode === entry}
                disabled={busy}
                onClick={() => {
                  setMode(entry);
                  invalidate();
                }}
              >
                {entry === "script" ? "选择剧本" : "粘贴剧本"}
              </button>
            ))}
          </div>
          {mode === "script" && (
            <CustomSelect
              ariaLabel="项目分镜"
              value={chosen}
              options={scenes.map(({ scene, label }) => ({
                value: scene.id,
                label,
              }))}
              disabled={busy}
              placeholder="选择项目中的一场戏"
              onChange={(id) => {
                setChosen(id);
                setTitle(
                  scenes.find((entry) => entry.scene.id === id)?.scene.title ??
                    "",
                );
                invalidate();
              }}
            />
          )}
          <label className="script-previs-text">
            <span className="script-previs-field-heading">
              <span>剧本文本</span>
              <small>
                {raw.length.toLocaleString()} / 12,000 字 · {lineCount} 行
              </small>
            </span>
            <textarea
              aria-label="剧本文本"
              maxLength={12000}
              value={raw}
              disabled={busy}
              readOnly={mode === "script"}
              placeholder={
                "室内 · 咖啡馆 · 夜\n小林：你终于来了。\n小夏走到桌旁，放下手中的杯子。"
              }
              onChange={(event) => {
                setPaste(event.target.value);
                invalidate();
              }}
            />
          </label>
          <div className="script-previs-analysis">
            {canUseModels && (
              <TextModelSelect
                value={model}
                onChange={setModel}
                disabled={busy}
              />
            )}
            {canUseModels && (
              <button
                type="button"
                className="creative-primary"
                disabled={busy || !raw.trim() || !model}
                onClick={() => analyze(true)}
              >
                <Sparkles size={14} aria-hidden />
                AI 解析
              </button>
            )}
            <button
              type="button"
              className="creative-quiet"
              disabled={busy || !raw.trim()}
              onClick={() => analyze(false)}
            >
              <ScanText size={14} aria-hidden />
              规则解析
            </button>
          </div>
        </div>
        <div className="script-previs-preview">
          <div className="script-previs-section-heading">
            <h2>
              <Clapperboard size={15} aria-hidden />
              解析预览
            </h2>
            <span
              className={`script-previs-status${preview ? " is-ready" : ""}`}
              role="status"
            >
              {busy
                ? result
                  ? "正在试排…"
                  : "正在解析…"
                : preview
                  ? "可创建"
                  : result
                    ? "试排未完成"
                    : "待解析"}
            </span>
          </div>
          {previewContainer ? (
            createPortal(
              <div className="creative-previs-render" ref={root} />,
              previewContainer,
            )
          ) : (
            <div className="creative-previs-render" ref={root} />
          )}
          {!result && (
            <p className="script-previs-hint">
              选择或粘贴一个分镜的剧本，解析场景、人物和对白，在预演中核对站位与机位。
            </p>
          )}
          <dl className="script-previs-metrics" aria-label="解析统计">
            {[
              ["角色", result ? characters.length : "—"],
              ["道具", result ? result.props.length : "—"],
              ["对白", result ? result.dialogue.length : "—"],
              ["镜头", preview ? preview.shots.length : "—"],
            ].map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          {result && (
            <div className="script-previs-summary">
              {(result.location || result.time) && (
                <p className="script-previs-location">{locationSummary}</p>
              )}
              <div className="script-previs-stage-tools">
                <label className="script-previs-set">
                  <span>预演布景</span>
                  <CustomSelect
                    ariaLabel="预演布景"
                    value={template}
                    disabled={busy}
                    options={[
                      { value: "", label: "空场景" },
                      ...scriptSetOptions(transcript).items.map(
                        ({ id, name }) => ({ value: id, label: name }),
                      ),
                    ]}
                    onChange={(id) => {
                      setTemplate(id);
                      void run(() => build(transcript, id));
                    }}
                  />
                </label>
                {preview?.shots.length ? (
                  <button
                    type="button"
                    className="creative-quiet"
                    disabled={busy}
                    onClick={() => host.current?.playPreview()}
                  >
                    <Play size={14} aria-hidden /> 播放试排
                  </button>
                ) : null}
              </div>
              <dl className="script-previs-entities">
                <div>
                  <dt>角色</dt>
                  <dd>
                    {characters.length
                      ? characters.map((name) => <span key={name}>{name}</span>)
                      : "未识别"}
                  </dd>
                </div>
                <div>
                  <dt>道具</dt>
                  <dd>
                    {result.props.length
                      ? result.props.map((entry) => (
                          <span key={entry.name} title={entry.quote}>
                            {entry.name}
                          </span>
                        ))
                      : "未识别"}
                  </dd>
                </div>
              </dl>
              <details className="script-previs-detail" open>
                <summary>
                  镜头试排 <span>{preview?.shots.length ?? 0}</span>
                </summary>
                {preview?.shots.length ? (
                  <ol>
                    {preview.shots.map((shot, index) => (
                      <li key={index}>{shot}</li>
                    ))}
                  </ol>
                ) : (
                  <p>{busy ? "正在试排…" : "暂无镜头"}</p>
                )}
              </details>
              {result.dialogue.length > 0 && (
                <details
                  className="script-previs-detail"
                  open={result.dialogue.length <= 3}
                >
                  <summary>
                    对白 <span>{result.dialogue.length}</span>
                  </summary>
                  <ul className="script-previs-dialogue">
                    {result.dialogue.map((entry, index) => (
                      <li key={index}>
                        <strong>{entry.speaker}</strong>
                        <span>{entry.line}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {result.actions.length > 0 && (
                <details className="script-previs-detail">
                  <summary>
                    需核对的动作 <span>{result.actions.length}</span>
                  </summary>
                  <ul>
                    {result.actions.map((entry, index) => (
                      <li key={index}>{entry.quote}</li>
                    ))}
                  </ul>
                </details>
              )}
              {preview?.notice && (
                <p className="script-previs-notice">{preview.notice}</p>
              )}
            </div>
          )}
          {error && (
            <p className="creative-feedback" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
      <footer className="creative-toolbar">
        <label>
          场景名称{" "}
          <input
            aria-label="预演场景名称"
            placeholder="解析后自动命名，也可自行填写"
            maxLength={120}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div>
          <button
            type="button"
            className="creative-quiet"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="creative-primary"
            disabled={
              !preview ||
              creationDisabled ||
              !currentPreview ||
              busy ||
              (mode === "script" && !source)
            }
            onClick={() => {
              if (!preview || !currentPreview) return;
              void run(async () => {
                const scene = await createPrevis(project, {
                  format_version: 1,
                  title:
                    title.trim() ||
                    selected?.title ||
                    result?.location ||
                    "剧本预演",
                  document: preview.document,
                  script_source: analyzedInput?.source,
                });
                onCreated(scene);
              });
            }}
          >
            <Plus size={14} aria-hidden />
            创建白模场景
          </button>
        </div>
      </footer>
    </div>
  );
}
