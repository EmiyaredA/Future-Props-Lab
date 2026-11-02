import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { LoadingState } from "@shared/ui/LoadingState";
import { openAmadeus } from "@platform/assistant";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  ImagePlus,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Undo2,
  Upload,
} from "lucide-react";
import { ApiError } from "@platform/api/client";
import {
  applyOperations,
  getDocument,
  getProject,
  importAssets,
  listAssets,
  listImportSources,
  uploadAsset,
} from "./api";
import { MotionCanvas } from "./MotionCanvas";
import { MotionInspector } from "./MotionInspector";
import { MotionTimeline } from "./MotionTimeline";
import { ExportDialog } from "./ExportDialog";
import {
  cloneDocument,
  createLayer,
  pointsAt,
  updateLayer,
  valueAt,
} from "./model";
import type {
  MotionAsset,
  MotionKeyframe,
  MotionLayer,
  MotionProject,
  ResolvedDocument,
} from "./types";
import "./editor.css";

export function EditorPage({
  projectId,
  onBack,
  readOnly = false,
  registerNavigationGuard,
}: {
  projectId: string;
  onBack: () => void;
  readOnly?: boolean;
  registerNavigationGuard?: (
    guard: ((continueNavigation: () => void) => boolean) | null,
  ) => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const [project, setProject] = useState<MotionProject | null>(null);
  const [doc, setDoc] = useState<ResolvedDocument | null>(null);
  const docRef = useRef<ResolvedDocument | null>(null);
  const [assets, setAssets] = useState<MotionAsset[]>([]);
  const [sources, setSources] = useState<
    {
      id: string;
      displayName: string;
      mediaKind: string;
      sourceApplication: string;
    }[]
  >([]);
  const [showSources, setShowSources] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [precise, setPrecise] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const revisionRef = useRef(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const savePromise = useRef<Promise<number> | null>(null);
  const saveTimer = useRef<number | null>(null);
  const history = useRef<ResolvedDocument[]>([]);
  const future = useRef<ResolvedDocument[]>([]);
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [activeTab, setActiveTab] = useState<
    "assets" | "effects" | "templates"
  >("assets");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      getProject(projectId),
      getDocument(projectId),
      listAssets(projectId),
    ])
      .then(([projectResult, documentResult, assetsResult]) => {
        if (!alive) return;
        const next = documentResult.document as ResolvedDocument;
        setProject(projectResult);
        setDoc(next);
        docRef.current = next;
        revisionRef.current = documentResult.revision;
        setSavedRevision(documentResult.revision);
        setAssets(assetsResult.items);
      })
      .catch((caught: unknown) => {
        if (alive)
          setError(caught instanceof Error ? caught.message : "工程读取失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [projectId]);

  const save = useCallback(async (): Promise<number> => {
    if (readOnly) return revisionRef.current;
    if (savePromise.current) {
      await savePromise.current;
      if (savedVersionRef.current !== versionRef.current) return save();
      return revisionRef.current;
    }
    const snapshot = docRef.current;
    if (!snapshot || savedVersionRef.current === versionRef.current)
      return revisionRef.current;
    const version = versionRef.current;
    setSaving(true);
    const pending = applyOperations(projectId, revisionRef.current, [
      { type: "replaceDocument", document: snapshot },
    ])
      .then((result) => {
        revisionRef.current = result.revision;
        setSavedRevision(result.revision);
        savedVersionRef.current = version;
        setDirty(savedVersionRef.current !== versionRef.current);
        setConflict(false);
        setError("");
        return result.revision;
      })
      .catch((caught: unknown) => {
        if (caught instanceof ApiError && caught.status === 409) {
          setConflict(true);
          setError("工程已在别处更新。请检查本地修改，再加载服务端版本。");
        } else
          setError(caught instanceof Error ? caught.message : "自动保存失败");
        throw caught;
      })
      .finally(() => {
        savePromise.current = null;
        setSaving(false);
      });
    savePromise.current = pending;
    return pending;
  }, [projectId, readOnly]);

  useEffect(() => {
    if (!registerNavigationGuard) return;
    registerNavigationGuard((continueNavigation) => {
      if (versionRef.current === savedVersionRef.current) return false;
      void save()
        .then(continueNavigation)
        .catch(() => undefined);
      return true;
    });
    return () => registerNavigationGuard(null);
  }, [registerNavigationGuard, save]);

  const reloadCurrent = async () => {
    try {
      const current = await getDocument(projectId);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const next = current.document as ResolvedDocument;
      docRef.current = next;
      setDoc(next);
      revisionRef.current = current.revision;
      setSavedRevision(current.revision);
      versionRef.current = 0;
      savedVersionRef.current = 0;
      history.current = [];
      future.current = [];
      setHistoryState({ undo: 0, redo: 0 });
      setDirty(false);
      setConflict(false);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "工程刷新失败");
    }
  };

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () => void save().catch(() => undefined),
      700,
    );
  }, [save]);

  const change = useCallback(
    (next: ResolvedDocument, record = true) => {
      if (readOnly || !docRef.current) return;
      if (record) {
        history.current = [
          ...history.current.slice(-29),
          cloneDocument(docRef.current),
        ];
        future.current = [];
        setHistoryState({ undo: history.current.length, redo: 0 });
      }
      docRef.current = next;
      setDoc(next);
      versionRef.current += 1;
      setDirty(true);
      scheduleSave();
    },
    [readOnly, scheduleSave],
  );

  const beginEdit = useCallback(() => {
    if (!docRef.current || readOnly) return;
    history.current = [
      ...history.current.slice(-29),
      cloneDocument(docRef.current),
    ];
    future.current = [];
    setHistoryState({ undo: history.current.length, redo: 0 });
  }, [readOnly]);

  const undo = () => {
    const previous = history.current.pop();
    if (!previous || !docRef.current) return;
    future.current.push(cloneDocument(docRef.current));
    setHistoryState({
      undo: history.current.length,
      redo: future.current.length,
    });
    change(previous, false);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next || !docRef.current) return;
    history.current.push(cloneDocument(docRef.current));
    setHistoryState({
      undo: history.current.length,
      redo: future.current.length,
    });
    change(next, false);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  const playbackDuration = doc?.settings.durationFrames;
  const playbackFps = doc?.settings.fps;
  useEffect(() => {
    if (!playing || !playbackDuration || !playbackFps) return;
    const timer = window.setInterval(
      () =>
        setFrame((current) =>
          current + 1 >= playbackDuration ? 0 : current + 1,
        ),
      1000 / playbackFps,
    );
    return () => window.clearInterval(timer);
  }, [playing, playbackDuration, playbackFps]);

  const patchLayer = (
    id: string,
    patch: Partial<MotionLayer>,
    record = true,
  ) => {
    const current = docRef.current;
    if (!current) return;
    change(
      updateLayer(current, id, (layer) => ({ ...layer, ...patch })),
      record,
    );
  };
  const selected = doc?.layers.find((layer) => layer.id === selectedId) ?? null;
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("future-props:amadeus-context", {
        detail: {
          application: "特效制作工坊",
          projectId,
          unsaved: dirty || saving,
          selection: selected
            ? { id: selected.id, name: selected.name, value: selected.kind }
            : undefined,
        },
      }),
    );
  }, [projectId, dirty, saving, selected]);
  const add = (kind: MotionLayer["kind"], asset?: MotionAsset) => {
    const current = docRef.current;
    if (!current) return;
    const layer = createLayer(kind, current, asset);
    change({ ...cloneDocument(current), layers: [...current.layers, layer] });
    setSelectedId(layer.id);
    setActiveTab("assets");
  };
  const setTransform = (
    property: MotionKeyframe["property"],
    value: number,
  ) => {
    if (!selected || !docRef.current) return;
    const local = frame - selected.startFrame;
    patchLayer(
      selected.id,
      (selected.keyframes ?? []).some(
        (item) => item.property === property && item.frame === local,
      )
        ? {
            keyframes: (selected.keyframes ?? []).map((item) =>
              item.property === property && item.frame === local
                ? { ...item, value }
                : item,
            ),
          }
        : {
            transform: {
              x: 0,
              y: 0,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
              opacity: 1,
              ...selected.transform,
              [property]: value,
            },
          },
    );
  };
  const addKeyframe = (property: MotionKeyframe["property"]) => {
    if (!selected) return;
    const local = frame - selected.startFrame;
    if (local < 0 || frame >= selected.endFrame) return;
    const previous = (selected.keyframes ?? []).filter(
      (item) => !(item.property === property && item.frame === local),
    );
    patchLayer(selected.id, {
      keyframes: [
        ...previous,
        {
          id: crypto.randomUUID(),
          property,
          frame: local,
          value: valueAt(selected, property, frame),
          interpolation: "ease-out",
        },
      ],
    });
  };
  const removeKeyframe = (property: MotionKeyframe["property"]) => {
    if (!selected) return;
    patchLayer(selected.id, {
      keyframes: (selected.keyframes ?? []).filter(
        (item) =>
          !(
            item.property === property &&
            item.frame === frame - selected.startFrame
          ),
      ),
    });
  };
  const setMaskPoint = (index: number, x: number, y: number, record = true) => {
    if (!selected?.mask) return;
    const mask = selected.mask;
    const local = frame - selected.startFrame;
    const points = pointsAt(mask, local).map((point, pointIndex) =>
      pointIndex === index ? { ...point, x, y } : point,
    );
    if (local <= 0 && !(mask.keyframes ?? []).some((item) => item.frame === 0))
      patchLayer(selected.id, { mask: { ...mask, points } }, record);
    else
      patchLayer(
        selected.id,
        {
          mask: {
            ...mask,
            keyframes: [
              ...(mask.keyframes ?? []).filter((item) => item.frame !== local),
              { frame: local, points },
            ],
          },
        },
        record,
      );
  };
  const moveLayer = (step: number) => {
    const current = docRef.current;
    if (!selected || !current) return;
    const index = current.layers.findIndex((item) => item.id === selected.id);
    const target = index + step;
    if (index < 0 || target < 0 || target >= current.layers.length) return;
    const next = cloneDocument(current);
    [next.layers[index], next.layers[target]] = [
      next.layers[target],
      next.layers[index],
    ];
    change(next);
  };
  const removeLayer = () => {
    if (!selected || !docRef.current) return;
    change({
      ...cloneDocument(docRef.current),
      layers: docRef.current.layers.filter((item) => item.id !== selected.id),
    });
    setSelectedId(null);
  };
  const refreshAssets = async () =>
    setAssets((await listAssets(projectId)).items);
  const upload = async (file: File) => {
    try {
      await runTransfer((onProgress) =>
        uploadAsset(projectId, file, { onProgress }),
      );
      await refreshAssets();
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "素材上传失败");
    }
  };
  const openSources = async () => {
    try {
      setSources((await listImportSources()).items);
      setShowSources(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "素材读取失败");
    }
  };
  const doImport = async (assetId: string) => {
    try {
      await importAssets(projectId, [assetId]);
      await refreshAssets();
      setShowSources(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败");
    }
  };
  const updateBackground = (color: string) => {
    if (!docRef.current) return;
    change({
      ...cloneDocument(docRef.current),
      settings: { ...docRef.current.settings, backgroundColor: color },
    });
  };

  if (loading)
    return (
      <>
        <TransferFeedback progress={activeTransferProgress} />
        <LoadingState
          label="正在打开特效工程…"
          variant="region"
          className="mc-editor-state"
        />
      </>
    );
  if (!doc || !project)
    return (
      <div className="mc-editor-state">
        <TransferFeedback progress={activeTransferProgress} />

        {error || "工程无法打开"}
        <button onClick={onBack}>返回项目</button>
      </div>
    );
  return (
    <div className="mc-editor">
      <TransferFeedback progress={activeTransferProgress} />

      <header className="mc-editor-header">
        <button
          className="mc-icon-button"
          aria-label="返回特效项目"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="mc-brand" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path
              fill="currentColor"
              d="M9 1.1 10.2 7.8 16.9 9 10.2 10.2 9 16.9 7.8 10.2 1.1 9 7.8 7.8Z"
            />
          </svg>
        </div>
        <div className="mc-project-title">
          <strong>{project.title}</strong>
          <small>特效制作工坊 · 镜头 01</small>
        </div>
        <span className={`mc-save-state ${dirty ? "dirty" : ""}`}>
          {saving ? <Save size={14} /> : dirty ? "●" : <Check size={14} />}{" "}
          {saving ? (
            <LoadingState variant="inline" label="正在保存" />
          ) : dirty ? (
            "待保存"
          ) : (
            "已自动保存"
          )}
        </span>
        <div className="mc-header-spacer" />
        <button
          className="mc-toolbar-button"
          disabled={!historyState.undo || readOnly}
          onClick={undo}
        >
          <Undo2 size={16} />
          撤销
        </button>
        <button
          className="mc-toolbar-button"
          disabled={!historyState.redo || readOnly}
          onClick={redo}
        >
          <Redo2 size={16} />
          重做
        </button>
        <button
          className="mc-toolbar-button"
          onClick={() => void openAmadeus()}
          title="打开 Amadeus"
        >
          <Sparkles size={16} />
          Amadeus
        </button>
        <button
          className="mc-toolbar-button"
          aria-pressed={precise}
          onClick={() => setPrecise(!precise)}
        >
          精确帧
        </button>
        {!readOnly && (
          <button
            className="mc-export-button"
            onClick={() => setExportOpen(true)}
          >
            导出镜头 <ArrowRight size={16} />
          </button>
        )}
      </header>
      {error && (
        <div className="mc-editor-error" role="alert">
          {error}
          {conflict && (
            <button onClick={() => void reloadCurrent()}>
              放弃本地修改并加载服务端版本
            </button>
          )}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
      <div className="mc-editor-main">
        <aside className="mc-assets">
          <div className="mc-assets-tabs">
            {(["assets", "effects", "templates"] as const).map((tab) => (
              <button
                key={tab}
                aria-pressed={activeTab === tab}
                onClick={() => setActiveTab(tab)}
              >
                {
                  { assets: "项目素材", effects: "效果", templates: "模板" }[
                    tab
                  ]
                }
              </button>
            ))}
          </div>
          {activeTab === "assets" ? (
            <div className="mc-assets-content">
              <h3>已导入素材</h3>
              <div className="mc-asset-actions">
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,video/x-matroska"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                    event.target.value = "";
                  }}
                />
                <button
                  disabled={readOnly}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={15} /> 本地素材
                </button>
                <button disabled={readOnly} onClick={() => void openSources()}>
                  <ImagePlus size={15} /> 文件库 / AI 素材
                </button>
              </div>
              {showSources && (
                <div className="mc-source-list">
                  <div>
                    <strong>选择可导入素材</strong>
                    <button onClick={() => setShowSources(false)}>关闭</button>
                  </div>
                  {sources.map((source) => (
                    <button
                      key={source.id}
                      onClick={() => void doImport(source.id)}
                    >
                      {source.mediaKind === "video" ? "▣" : "▧"}{" "}
                      {source.displayName}
                      <small>{source.sourceApplication}</small>
                    </button>
                  ))}
                  {!sources.length && <p>当前账号没有可导入的图像或视频。</p>}
                </div>
              )}
              <div className="mc-asset-list">
                {assets.map((asset) => (
                  <button
                    key={asset.id}
                    disabled={readOnly}
                    onClick={() =>
                      add(
                        asset.mediaKind === "video" ? "video" : "image",
                        asset,
                      )
                    }
                  >
                    <span className="mc-asset-thumb">
                      {asset.mediaKind === "video" ? (
                        <Film size={24} />
                      ) : (
                        <ImagePlus size={24} />
                      )}
                    </span>
                    <strong>{asset.displayName}</strong>
                    <small>＋ 加入画布</small>
                  </button>
                ))}
              </div>
              <h3>快速添加</h3>
              <button
                className="mc-add-option"
                disabled={readOnly}
                onClick={() => add("text")}
              >
                T 文字与标题 <Plus size={15} />
              </button>
              <button
                className="mc-add-option"
                disabled={readOnly}
                onClick={() => add("shape")}
              >
                ◆ 图形与速度线 <Plus size={15} />
              </button>
            </div>
          ) : activeTab === "effects" ? (
            <div className="mc-assets-content">
              <h3>风格效果</h3>
              <p>选择图层后，在右侧调整描边、投影、网点和双色调。</p>
              <div className="mc-effect-samples">
                <span>◆ 描边</span>
                <span>◉ 网点</span>
                <span>✦ 双色调</span>
              </div>
            </div>
          ) : (
            <div className="mc-assets-content">
              <h3>原创特效模板</h3>
              <p>
                新建项目时可选「漫画风人物切入」。所有图层和关键帧都能继续编辑。
              </p>
            </div>
          )}
        </aside>
        <main className="mc-preview">
          <div className="mc-preview-toolbar">
            <strong>▣ 特效预览</strong>
            <span>路径遮罩 图层选择 手形工具</span>
            <div className="mc-header-spacer" />
            <span>
              {doc.settings.width} × {doc.settings.height} · {doc.settings.fps}{" "}
              fps
            </span>
          </div>
          <div className="mc-preview-surface">
            <MotionCanvas
              projectId={projectId}
              document={doc}
              assets={assets}
              frame={frame}
              selectedId={selectedId}
              precise={precise && !dirty && !playing}
              savedRevision={savedRevision}
              onSelect={setSelectedId}
              onMove={(id, x, y) => {
                const layer = docRef.current?.layers.find(
                  (item) => item.id === id,
                );
                if (!layer) return;
                patchLayer(
                  id,
                  {
                    transform: {
                      x,
                      y,
                      scaleX: layer.transform?.scaleX ?? 1,
                      scaleY: layer.transform?.scaleY ?? 1,
                      rotation: layer.transform?.rotation ?? 0,
                      opacity: layer.transform?.opacity ?? 1,
                    },
                  },
                  false,
                );
              }}
              onDragStart={beginEdit}
              onMaskPoint={(index, x, y) => setMaskPoint(index, x, y, false)}
            />
          </div>
          <div className="mc-preview-controls">
            <button
              aria-label={playing ? "暂停" : "播放"}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <span>
              {(frame / doc.settings.fps).toFixed(2)} /{" "}
              {(doc.settings.durationFrames / doc.settings.fps).toFixed(2)} 秒
            </span>
            <span className="mc-header-spacer" />
            <label>
              画布底色{" "}
              <input
                aria-label="画布底色 HEX"
                value={doc.settings.backgroundColor}
                onChange={(event) => updateBackground(event.target.value)}
                disabled={readOnly}
              />
            </label>
            <button
              onClick={() => void save().catch(() => undefined)}
              disabled={!dirty || readOnly}
            >
              <Save size={15} /> 保存
            </button>
          </div>
        </main>
        <MotionInspector
          layer={selected}
          frame={frame}
          onPatch={(patch) => {
            if (selected) patchLayer(selected.id, patch);
          }}
          onTransform={setTransform}
          onAddKeyframe={addKeyframe}
          onRemoveKeyframe={removeKeyframe}
          onMaskPoint={setMaskPoint}
          onRemove={removeLayer}
          onMoveLayer={moveLayer}
        />
      </div>
      <MotionTimeline
        document={doc}
        frame={frame}
        selectedId={selectedId}
        onFrame={setFrame}
        onSelect={setSelectedId}
        onChangeLayer={(id, patch, record) => patchLayer(id, patch, record)}
        onBeginEdit={beginEdit}
      />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        projectId={projectId}
        document={doc}
        onBeforeExport={save}
        onHandoff={(id) =>
          window.dispatchEvent(
            new CustomEvent("future-props:navigate", {
              detail: `/apps/video-editor/projects/${encodeURIComponent(id)}/editor`,
            }),
          )
        }
      />
    </div>
  );
}
