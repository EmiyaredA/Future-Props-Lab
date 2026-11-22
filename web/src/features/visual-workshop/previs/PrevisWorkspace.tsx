import { WorkspaceSidebar } from "../WorkspaceSidebar";
import { BoardMenu } from "../board/BoardMenu";
import {
  lazy,
  useEffect,
  Suspense,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { StageObjectBindings } from "./StageObjectBindings";
import {
  ArrowLeft,
  Box,
  Clapperboard,
  FileText,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigationGuard } from "@shared/ui/navigationGuards";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { apiErrorMessage } from "@platform/api/errors";
import { createSceneDocument } from "../../../../vendor/toonflow/trumanScene";
import type { VisualCanvasDocument } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import {
  createPrevis,
  deletePrevis,
  listPrevis,
  openPrevis,
  type PrevisScene,
} from "./api";
import emptyStage from "./empty-stage.webp";
import type { PrevisEditorHandle } from "./PrevisEditor";
import type { ScriptSeed } from "../creative/api";
import "./previs.css";

const ShotPrevisEditor = lazy(() =>
  import("./ShotPrevisEditor").then((module) => ({
    default: module.ShotPrevisEditor,
  })),
);
const PrevisEditor = lazy(() =>
  import("./PrevisEditor").then((module) => ({ default: module.PrevisEditor })),
);
const ScriptPrevisDraft = lazy(() => import("./ScriptPrevisDraft"));
const narrowScreen = "(max-width: 767px)";
function subscribeToScreen(change: () => void) {
  const media = window.matchMedia(narrowScreen);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}
function isNarrowScreen() {
  return window.matchMedia(narrowScreen).matches;
}

export default function PrevisWorkspace({
  projectId,
  readOnly = false,
  activeWorkspace = true,
  onBack,
  projectTitle,
  utilities,
  renderHeader,
  beforePublish,
  onPublished,
  seed,
  initialSceneId,
  shotId,
  projectCardIds = [],
  onAdopt,
}: {
  projectId: string;
  readOnly?: boolean;
  activeWorkspace?: boolean;
  onBack: () => void;
  projectTitle?: string;
  utilities?: ReactNode;
  renderHeader?: (
    busy: boolean,
    leave: (action: () => void | Promise<void>) => void,
  ) => ReactNode;
  beforePublish?: () => Promise<void>;
  onPublished?: (canvas: VisualCanvasDocument) => void;
  seed?: ScriptSeed;
  initialSceneId?: string;
  shotId?: string;
  onAdopt?: (
    scene: PrevisScene,
    file: File,
    number: number,
  ) => void | Promise<void>;
  projectCardIds?: string[];
}) {
  const narrow = useSyncExternalStore(subscribeToScreen, isNarrowScreen);
  const [sceneControlsHost, setSceneControlsHost] =
    useState<HTMLDivElement | null>(null);
  const client = useQueryClient();
  const sceneList = visualWorkshopQueryKeys.previs(projectId);
  const [editorReadOnly, setEditorReadOnly] = useState(false);
  const scenes = useQuery({
    queryKey: sceneList,
    queryFn: ({ signal }) => listPrevis(projectId, signal),
  });
  const [scope, setScope] = useState<"shot" | "stage">(
    shotId ? "shot" : "stage",
  );
  useEffect(() => {
    setScope(shotId ? "shot" : "stage");
  }, [shotId]);
  useEffect(() => {
    if (seed) setImporting(true);
  }, [seed]);
  const [active, setActive] = useState<PrevisScene>();
  const [importing, setImporting] = useState(Boolean(seed));
  const [importBusy, setImportBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [previewContainer, setPreviewContainer] =
    useState<HTMLDivElement | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const createMenu = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] =
    useState<Pick<PrevisScene, "id" | "revision" | "title">>();
  const [deleteError, setDeleteError] = useState("");
  const flight = useRef(false);
  const leaving = useRef(false);
  const editor = useRef<PrevisEditorHandle>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const libraryHeading = useId();
  const canCreate = !readOnly && !narrow;
  const empty = scenes.data?.length === 0;
  async function run(task: () => Promise<void>) {
    if (flight.current || importBusy) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  function leave(action: () => void | Promise<void>) {
    void run(async () => {
      if (editor.current && !(await editor.current.requestLeave())) return;
      leaving.current = true;
      try {
        await action();
      } finally {
        leaving.current = false;
      }
    });
  }

  useNavigationGuard((resume) => {
    if (!activeWorkspace) return false;
    if (leaving.current || (!editor.current && !flight.current && !importBusy))
      return false;
    leave(resume);
    return true;
  });

  useEffect(() => {
    if (!initialSceneId) return;
    const controller = new AbortController();
    void openPrevis(projectId, initialSceneId, controller.signal)
      .then((scene) => {
        setImporting(false);
        setActive(scene);
        setEditorReadOnly(narrow);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(apiErrorMessage(failure));
      });
    return () => controller.abort();
  }, [projectId, initialSceneId, narrow]);

  function closeScene() {
    setActive(undefined);
    void scenes.refetch();
  }

  const Editor = scope === "shot" && shotId ? ShotPrevisEditor : PrevisEditor;
  return (
    <section className="visual-previs-library" aria-label="白模预演">
      {renderHeader?.(busy || importBusy, leave) ?? (
        <header className="visual-previs-readonly-header">
          <button
            type="button"
            className="visual-previs-icon"
            aria-label="返回项目"
            disabled={busy || importBusy}
            onClick={() => leave(onBack)}
          >
            <ArrowLeft aria-hidden />
          </button>
          <strong>{projectTitle || "创作项目"}</strong>
          {utilities}
        </header>
      )}
      {shotId && (
        <div
          className="previs-scope-bar"
          role="group"
          aria-label="预演编辑范围"
        >
          <button disabled={busy} onClick={() => leave(onBack)}>
            返回分镜
          </button>
          <button
            aria-pressed={scope === "shot"}
            disabled={busy}
            onClick={() => leave(() => setScope("shot"))}
          >
            当前镜头 · 机位与走位
          </button>
          <button
            aria-pressed={scope === "stage"}
            disabled={busy}
            onClick={() => leave(() => setScope("stage"))}
          >
            共享舞台 · 结构与素材
          </button>
          <small>
            {scope === "shot" ? "镜头修改独立保存" : "舞台修改将供关联镜头共用"}
          </small>
        </div>
      )}
      <div className="visual-previs-layout">
        <WorkspaceSidebar label="场景" icon={Clapperboard}>
          <aside
            className="visual-previs-scenes"
            aria-labelledby={libraryHeading}
          >
            <label className="workspace-search">
              <Search size={16} aria-hidden />
              <input
                aria-label="搜索预演场景"
                placeholder="搜索预演场景…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="visual-previs-scenes-heading">
              <h1 id={libraryHeading}>预演场景</h1>
              {canCreate && (
                <div ref={createMenu}>
                  <BoardMenu
                    label="添加预演场景"
                    triggerClassName="visual-previs-icon visual-previs-add"
                    triggerIcon={<Plus aria-hidden />}
                    items={[
                      {
                        label: "新建空白场景",
                        icon: <Box size={15} aria-hidden />,
                        disabled: busy || importBusy,
                        onSelect: () => {
                          if (!active && !importing) {
                            nameInput.current?.focus();
                            return;
                          }
                          leave(() => {
                            setImporting(false);
                            closeScene();
                            requestAnimationFrame(() =>
                              nameInput.current?.focus(),
                            );
                          });
                        },
                      },
                      {
                        label: "从剧本创建",
                        icon: <FileText size={15} aria-hidden />,
                        disabled: busy || importBusy,
                        onSelect: () => leave(() => setImporting(true)),
                      },
                    ]}
                  />
                </div>
              )}
            </div>
            {scenes.isPending ? (
              <p className="visual-previs-empty-list" role="status">
                正在读取场景…
              </p>
            ) : empty ? (
              <p className="visual-previs-empty-list">暂无场景</p>
            ) : scenes.data?.length ? (
              <ul>
                {scenes.data
                  .filter((scene) =>
                    scene.title
                      .toLocaleLowerCase()
                      .includes(search.trim().toLocaleLowerCase()),
                  )
                  .map((scene) => (
                    <li key={scene.id}>
                      <button
                        className="visual-previs-scene"
                        type="button"
                        disabled={busy || importBusy}
                        aria-current={
                          active?.id === scene.id ? "true" : undefined
                        }
                        onClick={() => {
                          if (active?.id === scene.id) return;
                          leave(async () => {
                            const opened = await openPrevis(
                              projectId,
                              scene.id,
                            );
                            setEditorReadOnly(narrow);
                            setImporting(false);
                            setActive(opened);
                            if (active) void scenes.refetch();
                          });
                        }}
                      >
                        <Box size={17} aria-hidden />
                        <span>{scene.title}</span>
                      </button>
                      {canCreate && (
                        <button
                          className="visual-previs-icon visual-previs-delete"
                          type="button"
                          disabled={
                            busy || importBusy || active?.id === scene.id
                          }
                          aria-label={`删除场景 ${scene.title}`}
                          title="删除场景"
                          onClick={() => {
                            setDeleteError("");
                            setDeleting(scene);
                          }}
                        >
                          <Trash2 aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            ) : null}
            {active && (
              <details className="previs-scene-settings">
                <summary>场景设置</summary>
                <div ref={setSceneControlsHost} />
                <StageObjectBindings
                  project={projectId}
                  stage={active}
                  cardIds={projectCardIds}
                  readOnly={readOnly || editorReadOnly || importing}
                />
              </details>
            )}
          </aside>
        </WorkspaceSidebar>
        <div
          className={`previs-content${importing && !readOnly ? " is-creating" : ""}`}
        >
          <div className="previs-stage-region">
            <div
              ref={setPreviewContainer}
              className="previs-candidate"
              hidden={!previewing}
            />
            <div className="previs-current" hidden={previewing}>
              {active ? (
                <div className="visual-previs-workspace visual-previs-workspace-open">
                  {error && (
                    <p className="visual-previs-error" role="alert">
                      {error}
                    </p>
                  )}
                  <Suspense fallback={<p role="status">正在加载场景编辑器…</p>}>
                    <Editor
                      suspended={!activeWorkspace || previewing}
                      shotId={shotId!}
                      onAdopt={shotId ? onAdopt : undefined}
                      ref={editor}
                      sceneControlsHost={sceneControlsHost}
                      key={`${active.id}:${scope}`}
                      initial={active}
                      project={projectId}
                      interactionLocked={importing}
                      readOnly={readOnly || editorReadOnly || narrow}
                      leaving={busy}
                      beforePublish={beforePublish}
                      onPublished={onPublished}
                      onSaved={(scene) => {
                        if (scope === "stage") setActive(scene);
                        void client.invalidateQueries({ queryKey: sceneList });
                      }}
                      onClose={() => leave(closeScene)}
                    />
                  </Suspense>
                </div>
              ) : (
                <div className="visual-previs-workspace">
                  <div className="visual-previs-start" inert={importing}>
                    <img
                      className="visual-previs-illustration"
                      src={emptyStage}
                      alt=""
                      width={960}
                      height={620}
                    />
                    <h2>
                      {canCreate
                        ? empty
                          ? "新建第一个场景"
                          : "新建预演场景"
                        : empty
                          ? "这个项目还没有预演场景"
                          : "选择场景播放预演"}
                    </h2>
                    {canCreate ? (
                      <>
                        <p>搭建白模、安排走位和分镜</p>
                        <form
                          className="visual-previs-create"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const name = title.trim();
                            if (!name) return;
                            void run(async () => {
                              const scene = await createPrevis(projectId, {
                                format_version: 1,
                                title: name,
                                document: createSceneDocument(),
                              });
                              setTitle("");
                              setEditorReadOnly(false);
                              setActive(scene);
                              void scenes.refetch();
                            });
                          }}
                        >
                          <label htmlFor={nameId}>场景名称</label>
                          <input
                            id={nameId}
                            ref={nameInput}
                            value={title}
                            disabled={busy}
                            maxLength={120}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder="例如：室内对白"
                            required
                          />
                          <button
                            className="visual-previs-create-submit"
                            type="submit"
                            disabled={busy || !title.trim()}
                          >
                            新建预演场景
                          </button>
                        </form>
                      </>
                    ) : (
                      !readOnly && <p>请扩大窗口以编辑场景。</p>
                    )}
                    {(error || scenes.error) && (
                      <p className="visual-previs-error" role="alert">
                        {error || apiErrorMessage(scenes.error)}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          {importing && !readOnly && (
            <Suspense fallback={<p role="status">正在打开剧本解析…</p>}>
              <ScriptPrevisDraft
                project={projectId}
                suspended={!activeWorkspace}
                creationDisabled={narrow}
                previewContainer={previewContainer}
                onPreviewChange={setPreviewing}
                seed={seed}
                onBusy={setImportBusy}
                onCancel={() => {
                  setImporting(false);
                  setPreviewing(false);
                  createMenu.current?.querySelector("button")?.focus();
                }}
                onCreated={(scene) => {
                  setImporting(false);
                  setPreviewing(false);
                  setEditorReadOnly(false);
                  setActive(scene);
                  void scenes.refetch();
                }}
              />
            </Suspense>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`删除预演场景“${deleting?.title ?? ""}”？`}
        description={
          <>
            <p>已发送的画布素材会保留。</p>
            {deleteError && <p role="alert">{deleteError}</p>}
          </>
        }
        confirmLabel="删除"
        pending={busy}
        confirmDisabled={
          !canCreate || importBusy || active?.id === deleting?.id
        }
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          if (!deleting || !canCreate || active?.id === deleting.id) return;
          void run(async () => {
            setDeleteError("");
            try {
              await deletePrevis(projectId, deleting);
              setDeleting(undefined);
              await scenes.refetch();
            } catch (failure) {
              setDeleteError(apiErrorMessage(failure));
            }
          });
        }}
      />
    </section>
  );
}
