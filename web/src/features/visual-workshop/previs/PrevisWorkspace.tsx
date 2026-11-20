import {
  lazy,
  Suspense,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ArrowLeft, Clapperboard, FileText, Plus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigationGuard } from "@shared/ui/navigationGuards";
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
  onBack,
  projectTitle,
  utilities,
  renderHeader,
  beforePublish,
  onPublished,
  seed,
}: {
  projectId: string;
  readOnly?: boolean;
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
}) {
  const narrow = useSyncExternalStore(subscribeToScreen, isNarrowScreen);
  const client = useQueryClient();
  const sceneList = visualWorkshopQueryKeys.previs(projectId);
  const [editorReadOnly, setEditorReadOnly] = useState(false);
  const scenes = useQuery({
    queryKey: sceneList,
    queryFn: ({ signal }) => listPrevis(projectId, signal),
  });
  const [active, setActive] = useState<PrevisScene>();
  const [importing, setImporting] = useState(Boolean(seed));
  const [importBusy, setImportBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    if (leaving.current || (!editor.current && !flight.current && !importBusy))
      return false;
    leave(resume);
    return true;
  });

  function closeScene() {
    setActive(undefined);
    void scenes.refetch();
  }

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
      <div className="visual-previs-layout">
        <aside
          className="visual-previs-scenes"
          aria-labelledby={libraryHeading}
        >
          <div className="visual-previs-scenes-heading">
            <h1 id={libraryHeading}>预演场景</h1>
            {canCreate && (
              <button
                className="visual-previs-icon visual-previs-add"
                type="button"
                aria-label="添加预演场景"
                title="添加预演场景"
                disabled={busy}
                onClick={() => {
                  if (!active && !importing) {
                    nameInput.current?.focus();
                    return;
                  }
                  leave(() => {
                    setImporting(false);
                    closeScene();
                    requestAnimationFrame(() => nameInput.current?.focus());
                  });
                }}
              >
                <Plus aria-hidden />
              </button>
            )}
          </div>
          {canCreate && (
            <button
              className="visual-previs-scene visual-previs-import"
              type="button"
              disabled={busy || importBusy}
              aria-pressed={importing}
              onClick={() =>
                leave(() => {
                  setActive(undefined);
                  setImporting(true);
                })
              }
            >
              <FileText size={15} aria-hidden /> 从剧本创建
            </button>
          )}
          {scenes.isPending ? (
            <p className="visual-previs-empty-list" role="status">
              正在读取场景…
            </p>
          ) : empty ? (
            <p className="visual-previs-empty-list">暂无场景</p>
          ) : scenes.data?.length ? (
            <ul>
              {scenes.data.map((scene) => (
                <li key={scene.id}>
                  <button
                    className="visual-previs-scene"
                    type="button"
                    disabled={busy || importBusy}
                    aria-current={active?.id === scene.id ? "true" : undefined}
                    onClick={() => {
                      if (active?.id === scene.id) return;
                      leave(async () => {
                        const opened = await openPrevis(projectId, scene.id);
                        setEditorReadOnly(narrow);
                        setImporting(false);
                        setActive(opened);
                        if (active) void scenes.refetch();
                      });
                    }}
                  >
                    <Clapperboard size={17} aria-hidden />
                    <span>{scene.title}</span>
                  </button>
                  {canCreate && (
                    <button
                      className="visual-previs-icon visual-previs-delete"
                      type="button"
                      disabled={busy || importBusy || active?.id === scene.id}
                      aria-label={`删除场景 ${scene.title}`}
                      title="删除场景"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `删除预演场景“${scene.title}”？已发送的画布素材会保留。`,
                          )
                        )
                          return;
                        void run(async () => {
                          await deletePrevis(projectId, scene);
                          await scenes.refetch();
                        });
                      }}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
        {importing && canCreate ? (
          <Suspense fallback={<p role="status">正在打开剧本解析…</p>}>
            <ScriptPrevisDraft
              project={projectId}
              seed={seed}
              onBusy={setImportBusy}
              onCancel={() => setImporting(false)}
              onCreated={(scene) => {
                setImporting(false);
                setEditorReadOnly(false);
                setActive(scene);
                void scenes.refetch();
              }}
            />
          </Suspense>
        ) : active ? (
          <div className="visual-previs-workspace visual-previs-workspace-open">
            {error && (
              <p className="visual-previs-error" role="alert">
                {error}
              </p>
            )}
            <Suspense fallback={<p role="status">正在加载场景编辑器…</p>}>
              <PrevisEditor
                ref={editor}
                key={active.id}
                initial={active}
                project={projectId}
                readOnly={readOnly || editorReadOnly}
                leaving={busy}
                beforePublish={beforePublish}
                onPublished={onPublished}
                onSaved={() => {
                  void client.invalidateQueries({ queryKey: sceneList });
                }}
                onClose={() => leave(closeScene)}
              />
            </Suspense>
          </div>
        ) : (
          <div className="visual-previs-workspace">
            <div className="visual-previs-start">
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
    </section>
  );
}
