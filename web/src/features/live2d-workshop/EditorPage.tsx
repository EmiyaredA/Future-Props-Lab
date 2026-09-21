import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  Layers3,
  Network,
  PanelLeft,
  PanelRight,
  Play,
  Redo2,
  Save,
  Undo2,
  Upload,
} from "lucide-react";
import { ApiError } from "@platform/api/client";
import {
  getDocument,
  getProject,
  listAssets,
  saveDocument,
  uploadAsset,
} from "./api";
import { AnimationLibrary, AnimationTimeline } from "./AnimationPanel";
import { CharacterCanvas } from "./CharacterCanvas";
import { Modal } from "./Controls";
import { ExportPanel } from "./ExportPanel";
import { ObjectTree } from "./ObjectTree";
import { Inspector, type Edit } from "./Inspector";
import { ParameterStrip } from "./ParameterStrip";
import { parsePsd } from "./importLayers";
import {
  captureKey,
  clearBindings,
  copy,
  deformerTransform,
  evaluate,
  makePart,
  parameterValues,
  triangulate,
} from "./model";
import type {
  Asset,
  CharacterDocument,
  Deformer,
  Mode,
  Part,
  Point,
  Project,
} from "./types";
import "./workshop.css";
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
    guard: ((proceed: () => void) => boolean) | null,
  ) => void;
}) {
  const [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true);
  const [project, setProject] = useState<Project | null>(null),
    [doc, setDoc] = useState<CharacterDocument | null>(null),
    [assets, setAssets] = useState<Asset[]>([]);
  const [mode, setMode] = useState<Mode>("model"),
    [selected, setSelected] = useState(""),
    [vertexIndex, setVertexIndex] = useState(0),
    [parameterId, setParameterId] = useState("ParamAngleX"),
    [parameterValue, setParameterValue] = useState(0);
  const [motionId, setMotionId] = useState(""),
    [expressionId, setExpressionId] = useState(""),
    [overrides, setOverrides] = useState<Record<string, number>>({}),
    [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false),
    [conflict, setConflict] = useState(false),
    [historyTick, setHistoryTick] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({}),
    [confirmation, setConfirmation] = useState<{
      message: string;
      action: () => void;
    } | null>(null),
    [leaving, setLeaving] = useState<(() => void) | null>(null);
  const documentRef = useRef<CharacterDocument | null>(null),
    revision = useRef(0),
    version = useRef(0),
    savedVersion = useRef(0),
    savePromise = useRef<Promise<number> | null>(null),
    history = useRef<CharacterDocument[]>([]),
    future = useRef<CharacterDocument[]>([]),
    input = useRef<HTMLInputElement>(null),
    importAbort = useRef<AbortController | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    void Promise.all([
      getProject(projectId),
      getDocument(projectId),
      listAssets(projectId),
    ])
      .then(([p, snapshot, a]) => {
        if (!live) return;
        setProject(p);
        const value = snapshot.document as CharacterDocument;
        setDoc(value);
        documentRef.current = value;
        revision.current = snapshot.revision;
        setAssets(a.items);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      mounted.current = false;
      importAbort.current?.abort();
    };
  }, [projectId]);
  const checkpoint = useCallback(() => {
    if (documentRef.current) {
      history.current.push(copy(documentRef.current));
      if (history.current.length > 100) history.current.shift();
      future.current = [];
      setHistoryTick((t) => t + 1);
    }
  }, []);
  const edit: Edit = useCallback(
    (update, record = true) => {
      if (readOnly || !documentRef.current) return;
      if (record) checkpoint();
      const next = copy(documentRef.current);
      update(next);
      documentRef.current = next;
      version.current++;
      setDoc(next);
      setDirty(true);
    },
    [readOnly, checkpoint],
  );
  const undo = useCallback(
    (redo = false) => {
      if (readOnly || !documentRef.current) return;
      const source = redo ? future : history,
        target = redo ? history : future;
      const next = source.current.pop();
      if (!next) return;
      target.current.push(copy(documentRef.current));
      documentRef.current = next;
      version.current++;
      setDoc(next);
      setDirty(true);
      setHistoryTick((t) => t + 1);
    },
    [readOnly],
  );
  const save = useCallback(async (): Promise<number> => {
    if (!documentRef.current) throw new Error("工程尚未读取");
    if (savePromise.current) {
      await savePromise.current;
    }
    if (readOnly || version.current === savedVersion.current)
      return revision.current;
    if (conflict)
      throw new Error("存在版本冲突，请先保留本地修改或重新读取服务器版本");
    const snapshot = copy(documentRef.current),
      at = version.current;
    setSaving(true);
    const pending = saveDocument(projectId, revision.current, snapshot)
      .then((result) => {
        revision.current = result.revision;
        savedVersion.current = at;
        if (mounted.current) {
          setDirty(version.current !== at);
          setProject((p) => (p ? { ...p, revision: result.revision } : p));
        }
        return result.revision;
      })
      .catch((e) => {
        if (mounted.current) {
          setError(e.message);
          if (e instanceof ApiError && e.status === 409) setConflict(true);
        }
        throw e;
      })
      .finally(() => {
        savePromise.current = null;
        if (mounted.current) setSaving(false);
      });
    savePromise.current = pending;
    return pending;
  }, [projectId, readOnly, conflict]);
  useEffect(() => {
    registerNavigationGuard?.((proceed) => {
      if (!dirty && !busy) return false;
      setLeaving(() => proceed);
      return true;
    });
    return () => registerNavigationGuard?.(null);
  }, [dirty, busy, registerNavigationGuard]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty, busy]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save().catch(() => {});
      }
      if (
        e.key.toLowerCase() === "z" &&
        !/INPUT|TEXTAREA/.test((e.target as HTMLElement)?.tagName ?? "")
      ) {
        e.preventDefault();
        undo(e.shiftKey);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [save, undo]);
  const motion = doc?.motions.find((m) => m.id === motionId);
  useEffect(() => {
    if (!playing || !motion) return;
    let handle = 0,
      last = performance.now(),
      acc = 0;
    const tick = (now: number) => {
      acc += ((now - last) * motion.fps) / 1000;
      last = now;
      if (acc >= 1) {
        const count = Math.floor(acc);
        acc -= count;
        setFrame(
          (f) =>
            motion.loopStart +
            ((Math.max(f, motion.loopStart) - motion.loopStart + count) %
              (motion.loopEnd - motion.loopStart)),
        );
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, motion]);
  const values = useMemo(
    () =>
      doc
        ? parameterValues(
            doc,
            frame,
            mode === "animation" ? motionId : undefined,
            mode === "animation" ? expressionId : undefined,
            mode === "rig"
              ? { [parameterId]: parameterValue }
              : mode === "animation"
                ? overrides
                : {},
          )
        : {},
    [
      doc,
      frame,
      mode,
      motionId,
      expressionId,
      parameterId,
      parameterValue,
      overrides,
    ],
  );
  const posed = useMemo(
    () => (doc ? evaluate(doc, values) : { parts: [], deformers: [] }),
    [doc, values],
  );
  const shape =
    posed.parts.find((p) => p.id === selected) ??
    posed.deformers.find((d) => d.id === selected);
  const editShape = (fn: (node: Part | Deformer) => void, record = true) => {
    if (!shape) return;
    if (mode === "rig") {
      const next: Part | Deformer = copy(shape);
      if ("worldVertices" in next)
        delete (next as Part & { worldVertices?: Point[] }).worldVertices;
      fn(next);
      edit((d) => {
        const p = d.parameters.find((p) => p.id === parameterId)!;
        if (parameterValue === p.default) {
          const base =
            d.parts.find((p) => p.id === selected) ??
            d.deformers.find((d) => d.id === selected)!;
          Object.assign(base, next);
        }
        captureKey(d, parameterId, selected, parameterValue, next);
      }, record);
    } else
      edit((d) => {
        const target =
          d.parts.find((p) => p.id === selected) ??
          d.deformers.find((d) => d.id === selected);
        if (target) fn(target);
      }, record);
  };
  const localPoint = (index: number, world: Point): Point => {
    if (!shape) return world;
    const isPart = "vertices" in shape;
    let guess = { ...(isPart ? shape.vertices[index] : shape.points[index]) };
    const transform = deformerTransform(posed.deformers);
    const project = (p: Point) =>
      transform(
        isPart ? { x: p.x + shape.x, y: p.y + shape.y } : p,
        shape.parentId,
      );
    for (let n = 0; n < 8; n++) {
      const a = project(guess),
        b = project({ x: guess.x + 0.01, y: guess.y }),
        c = project({ x: guess.x, y: guess.y + 0.01 });
      const dx = world.x - a.x,
        dy = world.y - a.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.001) break;
      const ax = (b.x - a.x) / 0.01,
        ay = (b.y - a.y) / 0.01,
        bx = (c.x - a.x) / 0.01,
        by = (c.y - a.y) / 0.01,
        det = ax * by - ay * bx;
      if (Math.abs(det) < 1e-8) break;
      guess = {
        x: guess.x + (dx * by - dy * bx) / det,
        y: guess.y + (dy * ax - dx * ay) / det,
      };
    }
    return guess;
  };
  const addPoint = (world: Point) => {
    if (!doc || !shape || !("vertices" in shape)) return;
    const point = localPoint(0, world);
    const action = () =>
      edit((d) => {
        const p = d.parts.find((p) => p.id === selected)!;
        clearBindings(d, selected);
        p.vertices.push(point);
        p.uvs.push({
          x: Math.max(0, Math.min(1, point.x / p.width)),
          y: Math.max(0, Math.min(1, point.y / p.height)),
        });
        triangulate(p);
        setVertexIndex(p.vertices.length - 1);
      });
    if (
      doc.parameters.some((p) =>
        p.bindings.some((b) => b.targetId === selected),
      )
    )
      setConfirmation({
        message: "增加顶点会清除此部件的参数绑定，可通过撤销恢复。",
        action,
      });
    else action();
  };
  const onUrl = useCallback(
    (assetId: string, url: string | null) =>
      setUrls((previous) => {
        if (previous[assetId] === url) return previous;
        const next = { ...previous };
        if (url) next[assetId] = url;
        else delete next[assetId];
        return next;
      }),
    [],
  );
  const importFiles = async (files: File[]) => {
    if (!doc || readOnly) return;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    importAbort.current = abort;
    try {
      let imported: {
          file: File;
          name?: string;
          group?: string;
          x?: number;
          y?: number;
          opacity?: number;
          visible?: boolean;
        }[] = [],
        size: { width: number; height: number } | undefined;
      if (files.some((f) => /\.ps[db]$/i.test(f.name))) {
        if (files.length !== 1)
          throw new Error("请一次导入一个 PSD，或同时选择多张 PNG");
        const result = await parsePsd(files[0], abort.signal);
        size = result;
        imported = result.layers.map((l) => ({
          ...l,
          file: new File([l.blob], `${l.name}.png`, { type: "image/png" }),
        }));
      } else {
        if (files.some((f) => !f.name.toLowerCase().endsWith(".png")))
          throw new Error("请选择分层 PSD 或透明 PNG");
        imported = files.map((file) => ({ file }));
      }
      if (doc.parts.length + imported.length > 128)
        throw new Error("每个角色最多 128 个部件");
      const uploaded: { asset: Asset; layer: (typeof imported)[number] }[] = [];
      for (const layer of imported) {
        if (abort.signal.aborted) throw new Error("导入已取消");
        uploaded.push({
          asset: await uploadAsset(projectId, layer.file),
          layer,
        });
      }
      if (abort.signal.aborted || !mounted.current) return;
      setAssets((previous) => [...previous, ...uploaded.map((x) => x.asset)]);
      edit((d) => {
        if (size && !d.parts.length) {
          d.width = size.width;
          d.height = size.height;
        }
        for (const { asset, layer } of uploaded) {
          const p = makePart(asset, d, layer.x, layer.y);
          p.name = layer.name ?? p.name;
          p.group = layer.group ?? "";
          p.opacity = layer.opacity ?? 1;
          p.visible = layer.visible ?? true;
          d.parts.push(p);
          setSelected(p.id);
        }
      });
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const changeParameter = (id: string) => {
    setParameterId(id);
    setParameterValue(doc?.parameters.find((p) => p.id === id)?.default ?? 0);
  };
  if (!doc || !project)
    return (
      <div className="l2-loading">
        <button onClick={onBack}>返回项目</button>
        <p role={error ? "alert" : "status"}>{error || "正在读取角色工程…"}</p>
      </div>
    );
  return (
    <main className="l2-editor">
      <header className="l2-editor-header">
        <button
          aria-label="返回项目"
          onClick={() => {
            if (dirty || busy) setLeaving(() => onBack);
            else onBack();
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="l2-title">
          <strong>{project.title}</strong>
          <small>
            {readOnly
              ? "只读浏览"
              : saving
                ? "正在保存…"
                : dirty
                  ? "有未保存修改"
                  : "已保存"}{" "}
            · Live2D 工坊
          </small>
        </div>
        <nav>
          {(
            [
              { id: "model", label: "模型", icon: Layers3 },
              { id: "rig", label: "绑定", icon: Network },
              { id: "animation", label: "动画", icon: Play },
              { id: "export", label: "导出", icon: Download },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              aria-pressed={mode === tab.id}
              onClick={() => {
                setMode(tab.id);
                setPlaying(false);
                setOverrides({});
              }}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="l2-header-actions">
          <button
            aria-label="对象面板"
            aria-pressed={leftOpen}
            onClick={() => setLeftOpen((v) => !v)}
          >
            <PanelLeft size={16} />
          </button>
          <button
            aria-label="属性面板"
            aria-pressed={rightOpen}
            onClick={() => setRightOpen((v) => !v)}
          >
            <PanelRight size={16} />
          </button>
          <button
            aria-label="撤销"
            disabled={readOnly || !history.current.length}
            onClick={() => undo()}
            data-history={historyTick}
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label="重做"
            disabled={readOnly || !future.current.length}
            onClick={() => undo(true)}
          >
            <Redo2 size={16} />
          </button>
          <button
            disabled={readOnly || busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
            <span>导入素材</span>
          </button>
          <button
            className="l2-primary"
            disabled={readOnly || saving || conflict || busy}
            onClick={() => void save().catch(() => {})}
          >
            {dirty ? <Save size={16} /> : <Check size={16} />}保存
          </button>
        </div>
      </header>
      <input
        type="file"
        ref={input}
        hidden
        multiple
        accept=".png,.psd,.psb"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void importFiles(files);
        }}
      />
      {busy && (
        <div className="l2-notice">
          正在检查并导入分层素材…
          <button onClick={() => importAbort.current?.abort()}>取消</button>
        </div>
      )}
      {error && (
        <div className="l2-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>关闭提示</button>
        </div>
      )}
      {conflict && (
        <div className="l2-notice">
          本地修改已保留。
          <button
            onClick={() => {
              const blob = new Blob(
                [JSON.stringify(documentRef.current, null, 2)],
                { type: "application/json" },
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "character-local-changes.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            下载本地文档备份
          </button>
          <button
            onClick={() =>
              setConfirmation({
                message: "重新读取将放弃当前未保存修改。请先下载本地文档备份。",
                action: () => {
                  void getDocument(projectId)
                    .then((r) => {
                      const value = r.document as CharacterDocument;
                      documentRef.current = value;
                      setDoc(value);
                      revision.current = r.revision;
                      version.current++;
                      savedVersion.current = version.current;
                      setDirty(false);
                      setConflict(false);
                      history.current = [];
                      future.current = [];
                    })
                    .catch((e) => setError(e.message));
                },
              })
            }
          >
            重新读取服务器版本
          </button>
        </div>
      )}
      {mode === "export" ? (
        <ExportPanel
          doc={doc}
          projectId={projectId}
          save={save}
          dirty={dirty}
          revision={revision.current}
          readOnly={readOnly}
        />
      ) : (
        <>
          <div className="l2-editor-body">
            <aside className="l2-left" hidden={!leftOpen}>
              {mode === "animation" ? (
                <AnimationLibrary
                  doc={doc}
                  edit={edit}
                  motionId={motionId}
                  setMotion={(v) => {
                    setMotionId(v);
                    setFrame(0);
                    setPlaying(false);
                  }}
                  expressionId={expressionId}
                  setExpression={setExpressionId}
                  values={values}
                  overrides={overrides}
                  setOverrides={setOverrides}
                  readOnly={readOnly}
                />
              ) : (
                <ObjectTree
                  doc={doc}
                  selected={selected}
                  onSelect={(v) => {
                    setSelected(v);
                    setVertexIndex(0);
                  }}
                  edit={edit}
                  readOnly={readOnly}
                />
              )}
            </aside>
            <CharacterCanvas
              doc={doc}
              parts={posed.parts}
              deformers={posed.deformers}
              assets={assets}
              selected={selected}
              mode={mode}
              readOnly={readOnly || busy}
              urls={urls}
              onUrl={onUrl}
              onSelect={(v) => {
                setSelected(v);
                setVertexIndex(0);
              }}
              onGesture={checkpoint}
              onPoint={(index, point) => {
                setVertexIndex(index);
                const p = localPoint(index, point);
                editShape((n) => {
                  if ("vertices" in n) n.vertices[index] = p;
                  else n.points[index] = p;
                }, false);
              }}
              onAddPoint={addPoint}
            />
            <aside className="l2-right" hidden={!rightOpen}>
              {mode === "animation" ? (
                <>
                  <h2>预览参数</h2>
                  <p className="l2-hint">
                    拖动时间线或播放动作，检查表情与动作叠加结果。
                  </p>
                  {doc.parameters.map((p) => (
                    <div className="l2-value-row" key={p.id}>
                      <span>{p.name}</span>
                      <strong>{values[p.id].toFixed(2)}</strong>
                    </div>
                  ))}
                </>
              ) : (
                <Inspector
                  doc={doc}
                  selected={selected}
                  posed={shape}
                  mode={mode}
                  edit={edit}
                  editShape={editShape}
                  parameterId={parameterId}
                  onParameter={changeParameter}
                  parameterValue={parameterValue}
                  onValue={setParameterValue}
                  vertexIndex={vertexIndex}
                  setVertexIndex={setVertexIndex}
                  readOnly={readOnly || busy}
                  confirm={(message, action) =>
                    setConfirmation({ message, action })
                  }
                />
              )}
            </aside>
          </div>
          {mode === "rig" && (
            <ParameterStrip
              doc={doc}
              selected={selected}
              parameterId={parameterId}
              value={parameterValue}
              onValue={setParameterValue}
              edit={edit}
              readOnly={readOnly}
            />
          )}
          {mode === "animation" && (
            <AnimationTimeline
              doc={doc}
              motionId={motionId}
              frame={frame}
              setFrame={(v) => {
                setFrame(v);
                setOverrides({});
              }}
              playing={playing}
              setPlaying={(v) => {
                setPlaying(v);
                if (v) setOverrides({});
              }}
              values={values}
              edit={edit}
              readOnly={readOnly}
            />
          )}
        </>
      )}
      <Modal
        title="确认编辑操作"
        description={confirmation?.message ?? ""}
        open={!!confirmation}
        onClose={() => setConfirmation(null)}
      >
        <div className="l2-actions">
          <button onClick={() => setConfirmation(null)}>取消</button>
          <button
            className="l2-primary"
            onClick={() => {
              confirmation?.action();
              setConfirmation(null);
            }}
          >
            确认
          </button>
        </div>
      </Modal>
      <Modal
        title="离开角色编辑器？"
        description="当前修改尚未保存，或素材仍在导入。可以保存后离开，也可以留在此处继续编辑。"
        open={!!leaving}
        onClose={() => setLeaving(null)}
      >
        <div className="l2-actions">
          <button onClick={() => setLeaving(null)}>继续编辑</button>
          <button
            onClick={() => {
              importAbort.current?.abort();
              leaving?.();
              setLeaving(null);
            }}
          >
            放弃并离开
          </button>
          <button
            className="l2-primary"
            disabled={busy || saving || conflict}
            onClick={() =>
              void save()
                .then(() => {
                  leaving?.();
                  setLeaving(null);
                })
                .catch(() => {})
            }
          >
            保存后离开
          </button>
        </div>
      </Modal>
    </main>
  );
}
