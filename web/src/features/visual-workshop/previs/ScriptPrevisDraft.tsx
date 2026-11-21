import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, X } from "lucide-react";
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
  previewContainer,
  onPreviewChange,
  seed,
  onCreated,
  onCancel,
  onBusy,
}: {
  project: string;
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

  return (
    <div
      className={`creative-window script-previs-draft${previewContainer ? " is-docked" : ""}`}
      role="region"
      aria-label="从剧本创建预演"
    >
      <header className="creative-toolbar">
        <strong>从剧本创建预演</strong>
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
              ariaLabel="项目场次"
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
          <label>
            剧本文本
            <textarea
              aria-label="剧本文本"
              maxLength={12000}
              value={raw}
              disabled={busy}
              readOnly={mode === "script"}
              placeholder="室内 · 咖啡馆 · 夜"
              onChange={(event) => {
                setPaste(event.target.value);
                invalidate();
              }}
            />
          </label>
          <div className="creative-inline">
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
                AI 解析
              </button>
            )}
            <button
              type="button"
              className="creative-quiet"
              disabled={busy || !raw.trim()}
              onClick={() => analyze(false)}
            >
              规则解析
            </button>
          </div>
        </div>
        <div className="script-previs-preview">
          <h2>解析预览</h2>
          {previewContainer ? (
            createPortal(
              <div className="creative-previs-render" ref={root} />,
              previewContainer,
            )
          ) : (
            <div className="creative-previs-render" ref={root} />
          )}
          {!result && (
            <p className="creative-feedback">
              {busy ? "正在解析剧本…" : "选择或粘贴一场剧本，解析后查看预演。"}
            </p>
          )}
          {result && (
            <div className="script-previs-summary">
              {preview?.shots.length ? (
                <button
                  type="button"
                  className="creative-quiet"
                  disabled={busy}
                  onClick={() => host.current?.playPreview()}
                >
                  <Play size={14} /> 播放试排
                </button>
              ) : null}
              <CustomSelect
                ariaLabel="预演布景"
                value={template}
                disabled={busy}
                options={[
                  { value: "", label: "空场景" },
                  ...scriptSetOptions(transcript).items.map(({ id, name }) => ({
                    value: id,
                    label: name,
                  })),
                ]}
                onChange={(id) => {
                  setTemplate(id);
                  void run(() => build(transcript, id));
                }}
              />
              <p>
                <strong>角色</strong>{" "}
                {(preview?.characters.length
                  ? preview.characters
                  : result.characters.map((entry) => entry.name)
                ).join("、") || "未识别"}
              </p>
              <p>
                <strong>道具</strong>{" "}
                {result.props.map((entry) => entry.name).join("、") || "未识别"}
              </p>
              <p>
                <strong>镜头</strong>{" "}
                {preview?.shots.join("、") || (busy ? "正在试排…" : "暂无镜头")}
              </p>
              {result.actions.length > 0 && (
                <details>
                  <summary>需核对的动作</summary>
                  <ul>
                    {result.actions.map((entry, index) => (
                      <li key={index}>{entry.quote}</li>
                    ))}
                  </ul>
                </details>
              )}
              {preview?.notice && <p>{preview.notice}</p>}
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
            创建白模场景
          </button>
        </div>
      </footer>
    </div>
  );
}
