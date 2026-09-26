import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, fetchApiBlob } from "@platform/api/client";
import { BUNDLED_AMADEUS_PROJECT_ID } from "@shared/live2d/bundled";
import { loadAmadeusModel } from "@features/amadeus";
import {
  getDocument,
  getProject,
  listAssets,
  retireAsset,
  saveDocument,
  uploadAsset,
} from "./api";
import {
  AnimationLibrary,
  AnimationTimeline,
  AnimationValues,
} from "./AnimationPanel";
import { BonePanel } from "./BonePanel";
import { CameraBehaviorPanel } from "./CameraBehaviorPanel";
import { CharacterCanvas } from "./CharacterCanvas";
import { CubismWorkspace } from "./CubismWorkspace";
import { ExportPanel } from "./ExportPanel";
import { BuiltInExport, EditorDialogs } from "./EditorDialogs";
import { EditorToolbar } from "./EditorToolbar";
import {
  brushVertices,
  moveBone,
  moveShapePoint,
  paintBoneWeights,
} from "./editorBrush";
import { restoreSavedDocument } from "./editorRecovery";
import { inverseDeformedPoint } from "./editorCoordinates";
import { ObjectTree } from "./ObjectTree";
import { Inspector, type Edit } from "./Inspector";
import { ParameterStrip } from "./ParameterStrip";
import { parsePsd } from "./importLayers";
import { meshFromPng } from "./alphaMesh";
import { planPsdReimport, pngDimensions } from "./psdReimport";
import {
  captureKey,
  clearBindings,
  copy,
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
  readOnly: inheritedReadOnly = false,
  registerNavigationGuard,
}: {
  projectId: string;
  onBack: () => void;
  readOnly?: boolean;
  registerNavigationGuard?: (
    guard: ((proceed: () => void) => boolean) | null,
  ) => void;
}) {
  const builtIn = projectId === BUNDLED_AMADEUS_PROJECT_ID;
  const readOnly = inheritedReadOnly || builtIn;
  const [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true);
  const [project, setProject] = useState<Project | null>(null),
    [doc, setDoc] = useState<CharacterDocument | null>(null),
    [assets, setAssets] = useState<Asset[]>([]);
  const [mode, setMode] = useState<Mode>("model"),
    [selected, setSelected] = useState(""),
    [soloPartId, setSoloPartId] = useState<string | null>(null),
    [influence, setInfluence] = useState(""),
    [showWeights, setShowWeights] = useState(false),
    [weightBrush, setWeightBrush] = useState(false),
    [brushRadius, setBrushRadius] = useState(65),
    [brushStrength, setBrushStrength] = useState(1),
    [poseTrial, setPoseTrial] = useState<
      Record<string, { rotation: number; offsetX: number; offsetY: number }>
    >({}),
    [vertexIndex, setVertexIndex] = useState(0),
    [parameterId, setParameterId] = useState("ParamAngleX"),
    [parameterValue, setParameterValue] = useState(0);
  const [motionId, setMotionId] = useState(""),
    [expressionId, setExpressionId] = useState(""),
    [previewState, setPreviewState] = useState<
      | "idle"
      | "listening"
      | "thinking"
      | "tool"
      | "success"
      | "error"
      | "paused"
      | null
    >(null),
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
    importAbort = useRef<AbortController | null>(null),
    retiredAssets = useRef(new Set<string>()),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    if (builtIn) {
      void loadAmadeusModel()
        .then(({ document, urls: bundledUrls }) => {
          if (!live) return;
          const now = new Date().toISOString();
          setProject({
            id: projectId,
            title: "红莉栖 · Amadeus（内置案例）",
            revision: 0,
            createdAt: now,
            updatedAt: now,
            thumbnail: null,
          });
          setDoc(document);
          documentRef.current = document;
          setUrls(Object.fromEntries(bundledUrls));
          setAssets([]);
        })
        .catch((cause) => {
          if (live) setError(String(cause));
        });
      return () => {
        live = false;
        mounted.current = false;
      };
    }
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
  }, [projectId, builtIn]);
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
      .then(async (result) => {
        revision.current = result.revision;
        savedVersion.current = at;
        if (mounted.current) {
          setDirty(version.current !== at);
          setProject((p) => (p ? { ...p, revision: result.revision } : p));
        }
        const referenced = new Set(snapshot.parts.map((part) => part.assetId));
        const obsolete = [...retiredAssets.current].filter(
          (id) => !referenced.has(id),
        );
        let latestRevision = result.revision;
        for (const id of obsolete) {
          try {
            const updated = await retireAsset(projectId, id, latestRevision);
            latestRevision = updated.revision;
            revision.current = latestRevision;
            if (mounted.current) setProject(updated);
            retiredAssets.current.delete(id);
            if (mounted.current)
              setAssets((items) => items.filter((item) => item.id !== id));
          } catch {
            // The saved document remains valid; the server will reject a referenced asset.
          }
        }
        return latestRevision;
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
        setFrame((f) => {
          if (
            previewState &&
            doc?.stateBindings[previewState]?.motionId === motion.id &&
            doc.stateBindings[previewState]?.playback === "onceHold"
          ) {
            const next = Math.min(motion.duration, f + count);
            if (next >= motion.duration)
              queueMicrotask(() => setPlaying(false));
            return next;
          }
          return (
            motion.loopStart +
            ((Math.max(f, motion.loopStart) - motion.loopStart + count) %
              (motion.loopEnd - motion.loopStart))
          );
        });
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, motion, previewState, doc]);
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
  const posed = useMemo(() => {
    if (!doc) return { parts: [], deformers: [] };
    const trialDoc = Object.keys(poseTrial).length ? copy(doc) : doc;
    if (trialDoc !== doc)
      for (const bone of trialDoc.bones) {
        const trial = poseTrial[bone.id];
        if (trial) {
          bone.rotation += trial.rotation;
          bone.offsetX += trial.offsetX;
          bone.offsetY += trial.offsetY;
        }
      }
    return evaluate(trialDoc, values);
  }, [doc, values, poseTrial]);
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
  const localPoint = (index: number, world: Point): Point =>
    inverseDeformedPoint(shape, posed.deformers, index, world);
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
          width?: number;
          height?: number;
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
      const dimensions = await Promise.all(
        imported.map((layer) => pngDimensions(layer.file)),
      );
      imported = imported.map((layer, index) => ({
        ...layer,
        ...dimensions[index],
      }));
      const plan = size
        ? planPsdReimport(
            doc,
            imported.map((layer) => ({
              name: layer.name ?? layer.file.name.replace(/\.png$/i, ""),
              group: layer.group ?? "",
              x: layer.x ?? 0,
              y: layer.y ?? 0,
              width: layer.width!,
              height: layer.height!,
            })),
            size,
          )
        : null;
      if (plan?.errors.length) throw new Error(plan.errors.join("；"));
      if (!plan && doc.parts.length + imported.length > 128)
        throw new Error("每个角色最多 128 个部件");
      const commit = async () => {
        if (documentRef.current !== doc)
          throw new Error("工程在素材检查期间发生变化，请重新导入");
        setBusy(true);
        const uploaded: {
          asset: Asset;
          layer: (typeof imported)[number];
          index: number;
          mesh: Awaited<ReturnType<typeof meshFromPng>> | null;
        }[] = [];
        try {
          for (const [index, layer] of imported.entries()) {
            if (abort.signal.aborted) throw new Error("导入已取消");
            const mesh = plan?.matches.has(index)
              ? null
              : await meshFromPng(layer.file);
            uploaded.push({
              asset: await uploadAsset(projectId, layer.file),
              layer,
              index,
              mesh,
            });
          }
          if (abort.signal.aborted || !mounted.current)
            throw new Error("导入已取消");
          if (documentRef.current !== doc)
            throw new Error("工程在素材上传期间发生变化，请重新导入");
          setAssets((previous) => [
            ...previous,
            ...uploaded.map((item) => item.asset),
          ]);
          edit((draft) => {
            if (size && !draft.parts.length) {
              draft.width = size.width;
              draft.height = size.height;
              const avatarSide = Math.min(size.width, size.height * 0.6);
              draft.cameras = {
                avatar: {
                  x: (size.width - avatarSide) / 2,
                  y: 0,
                  width: avatarSide,
                  height: avatarSide,
                },
                stage: { x: 0, y: 0, width: size.width, height: size.height },
              };
            }
            for (const { asset, layer, index, mesh } of uploaded) {
              retiredAssets.current.add(asset.id);
              const matchedId = plan?.matches.get(index);
              const matched =
                matchedId && draft.parts.find((part) => part.id === matchedId);
              if (matched) {
                retiredAssets.current.add(matched.assetId);
                matched.assetId = asset.id;
                continue;
              }
              const part = makePart(asset, draft, layer.x, layer.y);
              if (mesh) Object.assign(part, mesh);
              part.name = layer.name ?? part.name;
              part.group = layer.group ?? "";
              part.opacity = layer.opacity ?? 1;
              part.visible = layer.visible ?? true;
              draft.parts.push(part);
              setSelected(part.id);
            }
          });
        } catch (exception) {
          for (const { asset } of uploaded) {
            try {
              const updated = await retireAsset(
                projectId,
                asset.id,
                revision.current,
              );
              revision.current = updated.revision;
              retiredAssets.current.delete(asset.id);
              if (mounted.current) setProject(updated);
            } catch {
              // Leave a failed upload unreferenced rather than deleting a newer revision.
            }
          }
          if (mounted.current)
            setError(
              exception instanceof Error ? exception.message : "导入失败",
            );
        } finally {
          if (mounted.current) setBusy(false);
        }
      };
      if (plan?.matches.size) {
        setBusy(false);
        setConfirmation({
          message: `${plan.notices.join("；")}。匹配图层仅替换 PNG 像素，保留现有位置、透明度、网格和绑定。`,
          action: () => void commit(),
        });
      } else await commit();
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
  const selectObject = (id: string) => {
    setSelected(id);
    setVertexIndex(0);
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
      <EditorToolbar
        title={project.title}
        mode={mode}
        onMode={(next) => {
          setMode(next);
          setPlaying(false);
          setOverrides({});
        }}
        readOnly={readOnly}
        saving={saving}
        dirty={dirty}
        busy={busy}
        conflict={conflict}
        error={error}
        onError={setError}
        builtIn={builtIn}
        inheritedReadOnly={inheritedReadOnly}
        onBack={onBack}
        onRequestLeave={() => setLeaving(() => onBack)}
        leftOpen={leftOpen}
        onLeftOpen={() => setLeftOpen((value) => !value)}
        rightOpen={rightOpen}
        onRightOpen={() => setRightOpen((value) => !value)}
        canUndo={!!history.current.length}
        canRedo={!!future.current.length}
        onUndo={undo}
        onRedo={() => undo(true)}
        historyTick={historyTick}
        onImport={(files) => void importFiles(files)}
        onCancelImport={() => importAbort.current?.abort()}
        onSave={() => void save().catch(() => {})}
        localDocument={doc}
        onRequestReload={() =>
          setConfirmation({
            message: "重新读取将放弃当前未保存修改。请先下载本地文档备份。",
            action: () => {
              void restoreSavedDocument({
                projectId,
                documentRef,
                revision,
                version,
                savedVersion,
                history,
                future,
                setDoc,
                setDirty,
                setConflict,
              }).catch((cause) => setError(cause.message));
            },
          })
        }
      />
      {mode === "export" && builtIn ? (
        <BuiltInExport />
      ) : mode === "export" ? (
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
                    setOverrides({});
                  }}
                  expressionId={expressionId}
                  setExpression={setExpressionId}
                  onPreviewState={(state) => {
                    setPreviewState(state);
                    setFrame(0);
                    setPlaying(false);
                  }}
                  values={values}
                  overrides={overrides}
                  setOverrides={setOverrides}
                  readOnly={readOnly}
                />
              ) : (
                <ObjectTree
                  doc={doc}
                  selected={selected}
                  soloPartId={soloPartId}
                  onSoloPart={setSoloPartId}
                  onSelect={selectObject}
                  edit={edit}
                  readOnly={readOnly}
                />
              )}
            </aside>
            <CubismWorkspace
              projectId={projectId}
              revision={revision.current}
              dirty={dirty}
              readOnly={readOnly}
              enabled={!builtIn}
              template={doc}
              onRevision={(next) => {
                revision.current = next;
                setProject((current) =>
                  current ? { ...current, revision: next } : current,
                );
              }}
            >
              <CharacterCanvas
                doc={doc}
                parts={posed.parts.filter(
                  (part) => !soloPartId || part.id === soloPartId,
                )}
                deformers={posed.deformers}
                assets={assets}
                selected={selected}
                mode={mode}
                readOnly={readOnly || busy}
                urls={urls}
                onUrl={onUrl}
                influence={influence || doc.bones[0]?.id || ""}
                showWeights={showWeights}
                brush={weightBrush}
                brushRadius={brushRadius}
                onWeightBrush={(point) => {
                  const posedPart = posed.parts.find(
                    (part) => part.id === selected,
                  );
                  const boneId = influence || doc.bones[0]?.id;
                  if (!posedPart?.skinWeights || !boneId) return;
                  const vertices = brushVertices(
                    posedPart.worldVertices,
                    point,
                    brushRadius,
                  );
                  if (!vertices.length) return;
                  edit(
                    (draft) =>
                      paintBoneWeights(
                        draft,
                        selected,
                        vertices,
                        boneId,
                        brushStrength,
                      ),
                    false,
                  );
                }}
                onSelect={selectObject}
                onGesture={checkpoint}
                onVertexSelect={setVertexIndex}
                onBonePoint={(id, point) =>
                  edit((draft) => moveBone(draft, id, point), false)
                }
                onPoint={(index, point) => {
                  setVertexIndex(index);
                  const p = localPoint(index, point);
                  editShape((node) => moveShapePoint(node, index, p), false);
                }}
                onAddPoint={addPoint}
              />
            </CubismWorkspace>
            <aside className="l2-right" hidden={!rightOpen}>
              {mode === "animation" ? (
                <AnimationValues doc={doc} values={values} />
              ) : (
                <>
                  {mode === "rig" && (
                    <BonePanel
                      doc={doc}
                      selected={selected}
                      vertexIndex={vertexIndex}
                      setVertexIndex={setVertexIndex}
                      edit={edit}
                      readOnly={readOnly || busy}
                      influence={influence}
                      setInfluence={setInfluence}
                      showWeights={showWeights}
                      setShowWeights={setShowWeights}
                      brush={weightBrush}
                      setBrush={setWeightBrush}
                      brushRadius={brushRadius}
                      setBrushRadius={setBrushRadius}
                      brushStrength={brushStrength}
                      setBrushStrength={setBrushStrength}
                      trial={
                        poseTrial[selected] ?? {
                          rotation: 0,
                          offsetX: 0,
                          offsetY: 0,
                        }
                      }
                      setTrial={(trial) =>
                        setPoseTrial((previous) => ({
                          ...previous,
                          [selected]: trial,
                        }))
                      }
                    />
                  )}
                  {!(
                    mode === "rig" &&
                    doc.bones.some((bone) => bone.id === selected)
                  ) && (
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
                      onFitMesh={() => {
                        const part = doc.parts.find(
                          (item) => item.id === selected,
                        );
                        const asset = assets.find(
                          (item) => item.id === part?.assetId,
                        );
                        if (!part || !asset) return;
                        setBusy(true);
                        void fetchApiBlob(asset.url)
                          .then(meshFromPng)
                          .then((mesh) => {
                            const apply = () =>
                              edit((draft) => {
                                const target = draft.parts.find(
                                  (item) => item.id === part.id,
                                )!;
                                clearBindings(draft, part.id);
                                Object.assign(target, mesh);
                                target.skinWeights = undefined;
                                setVertexIndex(0);
                              });
                            if (
                              part.skinWeights ||
                              doc.parameters.some((parameter) =>
                                parameter.bindings.some(
                                  (binding) => binding.targetId === part.id,
                                ),
                              )
                            )
                              setConfirmation({
                                message:
                                  "按透明像素重建网格将清除此图层原有的蒙皮权重和参数关键形。可通过撤销恢复。",
                                action: apply,
                              });
                            else apply();
                          })
                          .catch((cause) =>
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : "网格生成失败",
                            ),
                          )
                          .finally(() => setBusy(false));
                      }}
                      confirm={(message, action) =>
                        setConfirmation({ message, action })
                      }
                    />
                  )}
                  {mode === "rig" && (
                    <CameraBehaviorPanel
                      doc={doc}
                      edit={edit}
                      readOnly={readOnly || busy}
                    />
                  )}
                </>
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
      <EditorDialogs
        confirmation={confirmation}
        onDismissConfirmation={() => setConfirmation(null)}
        onConfirm={() => {
          confirmation?.action();
          setConfirmation(null);
        }}
        leaving={!!leaving}
        onDismissLeaving={() => setLeaving(null)}
        onDiscard={() => {
          importAbort.current?.abort();
          leaving?.();
          setLeaving(null);
        }}
        onSaveLeave={() =>
          void save()
            .then(() => {
              leaving?.();
              setLeaving(null);
            })
            .catch(() => {})
        }
        busy={busy}
        saving={saving}
        conflict={conflict}
      />
    </main>
  );
}
