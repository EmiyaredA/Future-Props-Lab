import { createPortal } from "react-dom";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getProjectModels,
  projectModelsKey,
  readModelBlob,
  readProjectModel,
  uploadProjectModel,
} from "./projectModels";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  mountTrumanMap,
  validateScene,
  type SceneDocument,
  type ProjectSceneModel,
  type TrumanHostProps,
} from "../../../../vendor/toonflow/trumanHost";
import { cardsKey, listCards } from "../creative/api";
import { ApiError, apiErrorMessage } from "@platform/api/errors";
import type { VisualCanvasDocument } from "../api";
import { openPrevis, savePrevis, type PrevisScene } from "./api";
import {
  makePrevisBatch,
  publishPrevisBatch,
  type PrevisBatch,
} from "./publication";

export type PrevisEditorHandle = { requestLeave(): Promise<boolean> };

export function PrevisEditor({
  ref,
  initial,
  suspended = false,
  interactionLocked = false,
  project,
  readOnly,
  leaving,
  onClose,
  onSaved,
  beforePublish,
  onPublished,
  persistScene,
  validateChange,
  reloadScene,
  onAdopt,
  initialDirty = false,
  initialCameraId,
  onCameraChange,
  sceneControlsHost,
}: {
  onAdopt?: (
    scene: PrevisScene,
    file: File,
    number: number,
  ) => void | Promise<void>;
  initialDirty?: boolean;
  initialCameraId?: string;
  onCameraChange?: (id: string) => void;
  sceneControlsHost?: HTMLElement | null;
  persistScene?: (scene: PrevisScene) => Promise<PrevisScene>;
  validateChange?: (document: SceneDocument) => SceneDocument;
  reloadScene?: () => Promise<PrevisScene>;
  ref: Ref<PrevisEditorHandle>;
  initial: PrevisScene;
  suspended?: boolean;
  interactionLocked?: boolean;
  project: string;
  readOnly: boolean;
  leaving: boolean;
  onClose: () => void;
  onSaved: (scene: PrevisScene) => void;
  beforePublish?: () => Promise<void>;
  onPublished?: (canvas: VisualCanvasDocument) => void;
}) {
  const client = useQueryClient();
  const modelsKey = projectModelsKey(project);
  const models = useQuery({
    queryKey: modelsKey,
    queryFn: () => getProjectModels(project),
    enabled: !readOnly,
  });
  const cards = useQuery({
    queryKey: cardsKey,
    queryFn: () => listCards(),
    enabled: !readOnly,
  });
  const sharedModels = new Map<string, ProjectSceneModel>();
  for (const card of cards.data ?? []) {
    const path = card.model_asset_key;
    const id = /^assets\/project-models\/([a-f0-9-]{36})\.glb$/.exec(
      path ?? "",
    )?.[1];
    if (
      card.archived ||
      !id ||
      !path ||
      card.media_projects?.[id] === project ||
      sharedModels.has(path)
    )
      continue;
    sharedModels.set(path, {
      id: `project-model-${id}`,
      kind: "model",
      category: "本地",
      path,
      name: `设定库 · ${card.title}`.slice(0, 160),
      bytes: 0,
      normalize: true,
    });
  }
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<ReturnType<typeof mountTrumanMap>>(null);
  const saved = useRef(initial);
  const baseline = useRef<SceneDocument | null>(null);
  const draft = useRef<SceneDocument | null>(null);
  if (!draft.current)
    draft.current = baseline.current = validateScene(initial.document);
  const titleDraft = useRef(initial.title);
  const pendingInitialSave = useRef(initialDirty && !readOnly);
  const flight = useRef<Promise<PrevisScene> | null>(null);
  const batch = useRef<PrevisBatch | null>(null);
  const retry = useRef<AbortController | null>(null);
  const [cameraId, setCameraId] = useState(initialCameraId ?? "");
  const [capturing, setCapturing] = useState(false);
  const [title, setTitle] = useState(initial.title);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [status, setStatus] = useState(readOnly ? "只读预演" : "已保存");
  const locked =
    saving || publishing || capturing || leaving || interactionLocked;

  async function save() {
    if (flight.current) return flight.current;
    const current = draft.current!;
    const nextTitle = titleDraft.current.trim();
    if (
      readOnly ||
      (current === baseline.current &&
        nextTitle === saved.current.title &&
        !pendingInitialSave.current)
    )
      return saved.current;
    setSaving(true);
    setError("");
    const pending = persistScene
      ? persistScene({ ...saved.current, title: nextTitle, document: current })
      : savePrevis(project, saved.current, {
          title: nextTitle,
          format_version: 1,
          document: current,
        });
    flight.current = pending;
    try {
      const result = await pending;
      saved.current = result;
      baseline.current = current;
      pendingInitialSave.current = false;
      onSaved(result);
      setConflict(false);
      setStatus(
        draft.current === current && titleDraft.current.trim() === nextTitle
          ? "已保存"
          : "有未保存的修改",
      );
      return result;
    } catch (failure) {
      setConflict(failure instanceof ApiError && failure.status === 409);
      setError(apiErrorMessage(failure, "预演场景保存失败"));
      throw failure;
    } finally {
      flight.current = null;
      setSaving(false);
    }
  }

  async function retryBatch(signal: AbortSignal, onItem?: () => void) {
    const currentBatch = batch.current;
    if (!currentBatch || !onPublished) return 0;
    setPublishing(true);
    setError("");
    try {
      await beforePublish?.();
      const result = await publishPrevisBatch(
        project,
        currentBatch,
        signal,
        onPublished,
        onItem,
      );
      batch.current = null;
      setStatus(`已发送 ${result} 个素材到画布`);
      return result;
    } catch (failure) {
      const { published, remaining } = currentBatch;
      setError(
        `已发送 ${published} 个，剩余 ${remaining.length} 个待重试。 ${apiErrorMessage(failure)}`,
      );
      throw failure;
    } finally {
      setPublishing(false);
    }
  }

  useImperativeHandle(ref, () => ({
    async requestLeave() {
      if (saving || publishing || capturing || host.current?.isBusy()) {
        setError("请等待当前操作完成，再离开场景。");
        return false;
      }
      if (
        batch.current &&
        !window.confirm(
          "仍有素材待发送。关闭场景会舍弃这次未发送的文件，是否关闭？",
        )
      )
        return false;
      try {
        await save();
        return true;
      } catch {
        return false;
      }
    },
  }));

  const props: TrumanHostProps = {
    interactionLocked,
    document: draft.current,
    readOnly,
    shotScoped: Boolean(validateChange),
    saving: saving || publishing || leaving,
    statusMessage: status,
    error,
    onChange(document) {
      if (readOnly) return;
      try {
        document = validateChange?.(document) ?? document;
      } catch (failure) {
        setError(apiErrorMessage(failure));
        draft.current = structuredClone(draft.current!);
        host.current?.update({ ...latest.current, document: draft.current });
        return;
      }
      setError("");
      draft.current = document;
      setStatus("有未保存的修改");
      host.current?.update({ ...latest.current, document });
    },
    onSave: () => {
      void save().catch(() => undefined);
    },
    onClose,
    projectModels: [
      ...(models.data?.map((model) => {
        const card = cards.data?.find(
          (item) => !item.archived && item.model_asset_key === model.path,
        );
        return card
          ? { ...model, name: `${card.title} · ${model.name}`.slice(0, 160) }
          : model;
      }) ?? []),
      ...sharedModels.values(),
    ],
    loadProjectModel: async (path) =>
      path && sharedModels.has(path)
        ? (await readModelBlob(path)).arrayBuffer()
        : readProjectModel(project, path),
    prepareProjectModel: readOnly
      ? undefined
      : async (asset, signal) => {
          if (!sharedModels.has(asset.path)) return asset;
          const blob = await readModelBlob(asset.path, undefined, signal);
          const file = new File([blob], `${asset.name}.glb`, {
            type: blob.type,
          });
          const placed = await uploadProjectModel(project, file, signal);
          void client.invalidateQueries({ queryKey: modelsKey });
          return placed;
        },
    importProjectModel: readOnly
      ? undefined
      : async (file, signal) => {
          const model = await uploadProjectModel(project, file, signal);
          void client.invalidateQueries({ queryKey: modelsKey });
          return model;
        },
    beforeExport: async (signal) => {
      if (batch.current) throw new Error("请先处理上一批待发送的素材");
      await save();
      signal.throwIfAborted();
    },
    exportCanvas:
      !readOnly && onPublished
        ? {
            check() {
              if (batch.current) throw new Error("请先处理上一批待发送的素材");
            },
            async deliver(bundle, signal, onItem) {
              batch.current = await makePrevisBatch(saved.current, bundle);
              return retryBatch(signal, onItem);
            },
          }
        : undefined,
  };
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    if (!root.current || suspended) return;
    const instance = mountTrumanMap(root.current, latest.current);
    host.current = instance;
    return () => {
      host.current = null;
      instance.dispose();
    };
  }, [suspended]);
  useLayoutEffect(() => {
    host.current?.update(props);
  });
  useEffect(() => {
    function warnIfDirty(event: BeforeUnloadEvent) {
      if (
        batch.current ||
        pendingInitialSave.current ||
        draft.current !== baseline.current ||
        titleDraft.current.trim() !== saved.current.title
      ) {
        event.preventDefault();
      }
    }
    window.addEventListener("beforeunload", warnIfDirty);
    return () => {
      retry.current?.abort();
      window.removeEventListener("beforeunload", warnIfDirty);
    };
  }, []);

  const cameras = (draft.current?.cameras ?? []) as {
    id: string;
    name: string;
  }[];
  const selectedCamera = cameraId || cameras[0]?.id || "";
  async function capture(kind: "frame" | "clip") {
    if (locked || readOnly || !host.current || !onAdopt || !selectedCamera)
      return;
    setCapturing(true);
    setError("");
    try {
      onCameraChange?.(selectedCamera);
      const scene = await save();
      host.current.update({ ...latest.current, saving: false });
      const result = await host.current.captureReference(kind, selectedCamera);
      await onAdopt(scene, result.file, result.number);
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setCapturing(false);
    }
  }
  const controls = (
    <div className="visual-previs-bar">
      <label>
        场景名称
        <input
          aria-label="场景名称"
          disabled={readOnly || locked || Boolean(persistScene)}
          value={title}
          maxLength={120}
          onChange={(event) => {
            titleDraft.current = event.target.value;
            setTitle(event.target.value);
            setStatus("有未保存的修改");
          }}
        />
      </label>
      {conflict && (
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            if (!window.confirm("载入服务器版本会舍弃本地场景草稿，是否继续？"))
              return;
            void (
              reloadScene
                ? reloadScene()
                : openPrevis(project, saved.current.id)
            )
              .then((remote) => {
                draft.current = baseline.current = validateScene(
                  remote.document,
                );
                saved.current = remote;
                titleDraft.current = remote.title;
                setTitle(remote.title);
                setConflict(false);
                setError("");
                setStatus("已载入服务器版本");
              })
              .catch((failure: unknown) => setError(apiErrorMessage(failure)));
          }}
        >
          载入服务器版本
        </button>
      )}
      {batch.current?.remaining.length ? (
        publishing ? (
          <button
            type="button"
            onClick={() => retry.current?.abort()}
            disabled={!retry.current}
          >
            停止发送
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                const controller = new AbortController();
                retry.current = controller;
                void retryBatch(controller.signal)
                  .catch(() => undefined)
                  .finally(() => {
                    retry.current = null;
                  });
              }}
            >
              继续发送剩余素材
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                batch.current = null;
                setError("");
                setStatus("已结束待发送批次");
              }}
            >
              结束发送
            </button>
          </>
        )
      ) : null}
      {onAdopt && !readOnly && (
        <>
          <CustomSelect
            ariaLabel="采用预演的机位"
            value={selectedCamera}
            disabled={locked}
            onChange={(id) => {
              setCameraId(id);
              onCameraChange?.(id);
            }}
            options={cameras.map((camera) => ({
              value: camera.id,
              label: camera.name,
            }))}
          />
          <button
            type="button"
            disabled={locked || !selectedCamera}
            onClick={() => void capture("frame")}
          >
            采用当前帧
          </button>
          <button
            type="button"
            disabled={locked || !selectedCamera}
            onClick={() => void capture("clip")}
          >
            采用预演片段
          </button>
        </>
      )}
    </div>
  );
  return (
    <section className="visual-previs-editor" aria-label="镜头预演编辑器">
      {sceneControlsHost === undefined
        ? controls
        : sceneControlsHost
          ? createPortal(controls, sceneControlsHost)
          : null}
      <div ref={root} className="visual-previs-host" />
    </section>
  );
}
