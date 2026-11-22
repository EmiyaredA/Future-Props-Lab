import type { ProjectWorkspace, WorkbenchView } from "../ProjectCreativeTools";
import {
  ProjectWorkspaceNavigation,
  type WorkspaceEditorState,
  type WorkspaceLeave,
} from "../ProjectWorkspaceNavigation";
import type { WorkbenchSection } from "../board/MaterialViews";
import type { StoryboardWorkbench } from "../storyboard/workbench";
import type { Shot } from "../storyboard/api";
import { apiErrorMessage } from "@platform/api/errors";
import { LoadingState } from "@shared/ui/LoadingState";
import { useAccountId } from "@platform/auth/AccountAccess";
import "../project-workspace.css";
import "../workspace-controls.css";
import { subscribeAmadeusMutation } from "@platform/assistant";
import {
  assistantElementSource,
  useAssistantElements,
} from "@platform/assistantElements";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useUnsavedNavigation } from "@shared/ui/useUnsavedNavigation";
import type { VisualWorkshopCanvasPageProps } from "@features/visual-workshop/canvas/visualCanvasTypes";
import { useVisualCanvasController } from "@features/visual-workshop/canvas/useVisualCanvasController";
import { VisualWorkshopCanvasView } from "@features/visual-workshop/canvas/VisualWorkshopCanvasView";
import { VisualProjectHeader } from "./VisualProjectHeader";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { visualWorkshopQueryKeys } from "../queryKeys";
import { nodeLabel } from "./geometry";
import { ProjectBoard } from "@features/visual-workshop/board/ProjectBoard";
import {
  PrevisReferenceDialog,
  type PrevisAdoption,
} from "../previs/PrevisReferenceDialog";
import { getStoryboard } from "../storyboard/api";
import { productionDraft } from "../storyboard/productionDraft";
import { type VisualNodeOutput } from "../api";

import { cardsKey, listCards, type ScriptSeed } from "../creative/api";

const ScriptWorkspace = lazy(() => import("../creative/ScriptWorkspace"));
const StoryboardWorkspace = lazy(
  () => import("../storyboard/StoryboardWorkspace"),
);
const PrevisWorkspace = lazy(() => import("../previs/PrevisWorkspace"));

export function VisualWorkshopCanvasPage(props: VisualWorkshopCanvasPageProps) {
  const account = useAccountId();
  return (
    <ProjectWorkspacePage key={`${account}:${props.projectId}`} {...props} />
  );
}
function ProjectWorkspacePage(props: VisualWorkshopCanvasPageProps) {
  const [workspace, setWorkspace] = useState<ProjectWorkspace>("workbench");
  const [section, setSection] = useState<WorkbenchSection>("files");
  const [visited, setVisited] = useState({ script: false, previs: false });
  const [scriptSource, setScriptSource] = useState<Shot["source"]>();
  const [scriptSceneId, setScriptSceneId] = useState<string>();
  const [adoption, setAdoption] = useState<PrevisAdoption>();
  const [previsShotId, setPrevisShotId] = useState<string>();
  const [previsSceneId, setPrevisSceneId] = useState<string>();
  const [previsSeed, setPrevisSeed] = useState<ScriptSeed>();
  const [selectedShotId, setSelectedShotId] = useState<string>();
  const [selectedShot, setSelectedShot] = useState<Shot>();
  const [editorState, setEditorState] = useState({ busy: false, dirty: false });
  const [navigationError, setNavigationError] = useState("");
  const leave = useRef<WorkspaceLeave>((action) => {
    void action();
  });
  const navigating = useRef(false);
  const reportEditor = useCallback((state: WorkspaceEditorState) => {
    leave.current = state.leave;
    if (!state.busy) navigating.current = false;
    setEditorState((current) =>
      current.busy === state.busy && current.dirty === state.dirty
        ? current
        : { busy: state.busy, dirty: state.dirty },
    );
  }, []);
  const [pendingReveal, setPendingReveal] = useState<string>();
  const controller = useVisualCanvasController(props);
  const [historyPreviews, setHistoryPreviews] = useState<{
    projectId: string;
    items: Record<string, VisualNodeOutput | undefined>;
  }>({ projectId: props.projectId, items: {} });
  const [view, setView] = useState<WorkbenchView>(() =>
    localStorage.getItem(`visual-project-view:${props.projectId}`) === "board"
      ? "board"
      : "canvas",
  );
  const {
    projectId,
    projectQuery,
    title,
    nodes,
    selectedId,
    saveState,
    revealNodes,
  } = controller;
  useEffect(() => {
    if (!pendingReveal || workspace !== "workbench" || view !== "canvas")
      return;
    const node = nodes.find((item) => item.id === pendingReveal);
    if (!node) return;
    // The underlying canvas is hidden while a creation workspace is open.
    // Measure and reveal only after its visible DOM has committed.
    const frame = requestAnimationFrame(() => {
      revealNodes([node], { includeEditor: true });
      setPendingReveal(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingReveal, workspace, view, nodes, revealNodes]);
  const { refetch: refetchProject } = projectQuery;
  const { refetch: refetchCanvas } = controller.canvasQuery;
  const dirty = saveState !== "saved" || controller.editingTitle;
  const navigation = useUnsavedNavigation({
    dirty,
    busy: saveState === "saving",
    title: "画布尚未保存",
    description: "画布仍有未保存的修改，离开会丢失这些修改。",
  });
  useEffect(
    () =>
      subscribeAmadeusMutation({ resource: "visual", projectId }, async () => {
        if (dirty || editorState.dirty) return "dirty";
        await Promise.all([
          refetchProject({ throwOnError: true }),
          refetchCanvas({ throwOnError: true }),
        ]);
        return "updated";
      }),
    [projectId, dirty, editorState.dirty, refetchProject, refetchCanvas],
  );
  const projectTitle = title || projectQuery.data?.title || "视觉创作工坊";
  const selected =
    nodes.find((node) => node.id === selectedId) ??
    (view === "board" ? nodes[0] : undefined);
  useAssistantElements(
    assistantElementSource(
      {
        resource: "visual",
        projectId,
        application: "视觉创作工坊",
        unsaved: dirty || editorState.dirty,
        locate: ({ element_id }) => {
          const node = nodes.find((item) => item.id === element_id);
          if (!node) return false;
          controller.setSelectedId(element_id);
          if (view === "canvas") controller.revealNodes([node]);
          return true;
        },
      },
      nodes.map((node) => ({
        id: node.id,
        kind: "node",
        name: node.title || nodeLabel(node.kind),
        value: nodeLabel(node.kind),
      })),
      view === "canvas" && controller.selectedNodeIds.length
        ? controller.selectedNodeIds
        : selected
          ? [selected.id]
          : [],
    ),
  );
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("future-props:amadeus-context", {
        detail: {
          application: "视觉创作工坊",
          projectId,
          title: projectTitle,
          selection: selected
            ? {
                id: selected.id,
                name: selected.title || nodeLabel(selected.kind),
                value: nodeLabel(selected.kind),
              }
            : undefined,
          unsaved: dirty || editorState.dirty,
        },
      }),
    );
  }, [projectId, projectTitle, selected, dirty, editorState.dirty]);

  const navigate = (action: () => void | Promise<void>) => {
    if (navigating.current || editorState.busy || adoption) return;
    navigating.current = true;
    leave.current(async () => {
      try {
        setNavigationError("");
        if (controller.editingTitle) {
          if (!title.trim()) throw new Error("请填写项目名称");
          if (title.trim() !== projectQuery.data?.title)
            await controller.renameMutation.mutateAsync();
          controller.setEditingTitle(false);
        }
        await controller.prepareCanvasForAgent();
        await action();
      } catch (failure) {
        setNavigationError(apiErrorMessage(failure));
      } finally {
        navigating.current = false;
      }
    });
  };
  const switchWorkspace = (next: ProjectWorkspace) => {
    if (next === workspace) return;
    navigate(() => {
      setVisited((old) => ({ ...old, [next]: true }));
      setWorkspace(next);
    });
  };
  const switchView = (next: WorkbenchView) => {
    if (next === view) return;
    navigate(() => {
      try {
        localStorage.setItem(`visual-project-view:${projectId}`, next);
      } catch {
        /* Optional UI preference. */
      }
      setView(next);
    });
  };
  function openPrevis(seed?: ScriptSeed, sceneId?: string) {
    setPrevisSeed(seed);
    if (sceneId || seed) {
      setPrevisSceneId(sceneId);
      setPrevisShotId(undefined);
    }
    setVisited((old) => ({ ...old, previs: true }));
    setWorkspace("previs");
  }
  async function openShotPrevis(shot: Shot) {
    const { getCreationLinks } = await import("../creative/creationLinks");
    const links = await getCreationLinks(projectId);
    const stage =
      shot.previs?.scene_id ??
      links.scenes?.find((row) => shot.card_ids.includes(row.card_id))
        ?.previs_scene_id;
    setPrevisShotId(shot.id);
    setPrevisSceneId(stage);
    setPrevisSeed(undefined);
    setVisited((old) => ({ ...old, previs: true }));
    setWorkspace("previs");
  }
  function openScript(sceneId?: string, source?: Shot["source"]) {
    setScriptSource(source);
    if (sceneId) setScriptSceneId(sceneId);
    setVisited((old) => ({ ...old, script: true }));
    setWorkspace("script");
  }
  function openStoryboard(id?: string) {
    if (id) setSelectedShotId(id);
    setSection("storyboard");
    setWorkspace("workbench");
  }
  function locateNode(id: string) {
    controller.setSelectedId(id);
    controller.setSelectedNodeIds([id]);
    setSection("files");
    setView("canvas");
    setPendingReveal(id);
    controller.setInspectedNodeId(id);
    setWorkspace("workbench");
  }
  const { setSelectedId, setSelectedNodeIds } = controller;
  useEffect(() => {
    if (workspace !== "workbench" || section !== "storyboard" || !selectedShot)
      return;
    const id = nodes.find(
      (node) => node.id === selectedShot.video_node_id && node.kind === "video",
    )?.id;
    if (id === selectedId) return;
    setSelectedId(id ?? undefined);
    setSelectedNodeIds(id ? [id] : []);
    if (id && view === "canvas") setPendingReveal(id);
  }, [
    workspace,
    section,
    selectedShot,
    nodes,
    selectedId,
    view,
    setSelectedId,
    setSelectedNodeIds,
  ]);
  const renderEditorNavigation = (
    mode: ProjectWorkspace,
    busy: boolean,
    leave: WorkspaceLeave,
    dirty = false,
  ) =>
    workspace === mode ? (
      <ProjectWorkspaceNavigation
        busy={busy}
        dirty={dirty}
        leave={leave}
        onState={reportEditor}
      />
    ) : null;
  const renderWorkbench = (content: StoryboardWorkbench) => (
    <>
      {renderEditorNavigation(
        "workbench",
        content.busy,
        content.leave,
        content.dirty,
      )}
      <ProjectBoard
        embedded
        controller={{ ...controller, revealNode: (id) => setPendingReveal(id) }}
        view={view}
        onView={switchView}
        section={section}
        onSection={(next) => navigate(() => setSection(next))}
        storyboard={content}
        onCanvas={() => switchView("canvas")}
        onStoryboard={() => navigate(() => setSection("storyboard"))}
        onScript={(id) => navigate(() => openScript(id))}
        onPrevis={(id) => navigate(() => openPrevis(undefined, id))}
        canvasContent={
          <>
            <VisualWorkshopCanvasView embedded controller={controller} />
            {section === "storyboard" &&
              content.selected &&
              !nodes.some(
                (node) =>
                  node.id === content.selected?.video_node_id &&
                  node.kind === "video",
              ) && (
                <div className="workbench-unlinked-shot">
                  {content.editor}
                  {content.output}
                </div>
              )}
          </>
        }
        previews={historyPreviews.items}
        onPreview={(nodeId, version) =>
          setHistoryPreviews((current) => ({
            projectId,
            items: { ...current.items, [nodeId]: version },
          }))
        }
      />
    </>
  );
  return (
    <div className="visual-project-workspace">
      {navigation.dialog}
      <TransferFeedback progress={controller.transferProgress} />
      <VisualProjectHeader
        workspace={workspace}
        activeView={workspace === "workbench" ? view : undefined}
        onCanvas={() => switchView("canvas")}
        onBoard={() => switchView("board")}
        projectTitle={projectTitle}
        title={title}
        editingTitle={controller.editingTitle}
        saveState={saveState}
        busy={editorState.busy}
        saveStateText={
          editorState.busy ? "保存中" : editorState.dirty ? "未保存" : undefined
        }
        onWorkbench={() => switchWorkspace("workbench")}
        onScript={() => switchWorkspace("script")}
        onPrevis={() => switchWorkspace("previs")}
        onBack={() => navigate(controller.onBack)}
        onStartTitleEditing={() => controller.setEditingTitle(true)}
        onTitleChange={controller.setTitle}
        onSubmitTitle={() => {
          if (title.trim()) controller.renameMutation.mutate();
        }}
        onBlurTitle={() => {
          if (title.trim() && title !== projectQuery.data?.title)
            controller.renameMutation.mutate();
          else controller.setEditingTitle(false);
        }}
      />
      {navigationError && (
        <div className="workspace-feedback" role="alert">
          {navigationError}
          <button onClick={() => setNavigationError("")}>关闭</button>
        </div>
      )}
      <div
        className="project-workspace-body"
        hidden={workspace !== "workbench"}
        inert={workspace !== "workbench"}
      >
        <Suspense
          fallback={<LoadingState label="正在打开工作台…" variant="region" />}
        >
          <StoryboardWorkspace
            project={projectId}
            controller={controller}
            nodes={nodes}
            activeWorkspace={workspace === "workbench"}
            initialSelectedId={selectedShotId}
            onSelection={setSelectedShotId}
            onSelectedShot={setSelectedShot}
            projectCardIds={controller.projectCardIds}
            beforeSave={controller.prepareCanvasForAgent}
            renderHeader={() => null}
            renderWorkbench={renderWorkbench}
            onScript={openScript}
            onPrevis={openShotPrevis}
            onLocateNode={locateNode}
            onCreateNode={async (kind, title, generation_draft) => {
              if (!controller.canvasReady || controller.conflict)
                throw new Error("请先处理画布读取或保存冲突");
              const node = controller.createNode(kind);
              if (!node) throw new Error("制作节点创建失败");
              controller.patchNode(node.id, { title, generation_draft }, true);
              return node.id;
            }}
          />
        </Suspense>
      </div>
      {visited.script && (
        <div
          className="project-workspace-body"
          hidden={workspace !== "script"}
          inert={workspace !== "script"}
        >
          <Suspense
            fallback={<LoadingState label="正在打开剧本…" variant="region" />}
          >
            <ScriptWorkspace
              project={projectId}
              activeWorkspace={workspace === "script"}
              initialSceneId={scriptSceneId}
              initialSource={scriptSource}
              onStoryboard={openStoryboard}
              beforeStoryboardSave={controller.prepareCanvasForAgent}
              onPrepareShot={async (shot) => {
                if (
                  shot.video_node_id &&
                  controller
                    .readCanvas()
                    .nodes.some(
                      (node) =>
                        node.id === shot.video_node_id && node.kind === "video",
                    )
                ) {
                  return shot;
                }
                if (!controller.canvasReady || controller.conflict)
                  throw new Error("请先处理画布读取或保存冲突");
                const cards = await controller.client.fetchQuery({
                  queryKey: cardsKey,
                  queryFn: ({ signal }) => listCards(signal),
                });
                const generation_draft = await productionDraft(
                  controller.client,
                  projectId,
                  shot,
                  cards.filter(
                    (card) =>
                      controller.projectCardIds.includes(card.id) &&
                      !card.archived,
                  ),
                );
                const node = controller.createNode("video");
                if (!node) throw new Error("镜头视频创建失败");
                controller.patchNode(
                  node.id,
                  { title: shot.title, generation_draft },
                  true,
                );
                return { ...shot, video_node_id: node.id };
              }}
              onPrevis={openPrevis}
              renderHeader={(busy, leave, dirty) =>
                renderEditorNavigation("script", busy, leave, dirty)
              }
            />
          </Suspense>
        </div>
      )}
      {visited.previs && (
        <div
          className="project-workspace-body"
          hidden={workspace !== "previs"}
          inert={workspace !== "previs"}
        >
          <Suspense
            fallback={
              <LoadingState label="正在打开白模预演…" variant="region" />
            }
          >
            <PrevisWorkspace
              projectId={projectId}
              activeWorkspace={workspace === "previs"}
              onBack={() =>
                previsShotId
                  ? openStoryboard(previsShotId)
                  : setWorkspace("workbench")
              }
              seed={previsSeed}
              initialSceneId={previsSceneId}
              shotId={previsShotId}
              projectCardIds={controller.projectCardIds}
              onAdopt={async (scene, file, number) => {
                const board = await getStoryboard(projectId);
                const shot = board.shots.find((row) => row.id === previsShotId);
                const nodeId = nodes.find(
                  (node) =>
                    node.id === shot?.video_node_id && node.kind === "video",
                )?.id;
                if (!nodeId)
                  throw new Error("请先为分镜关联镜头视频，再采用预演结果");
                setAdoption({ scene, file, number, nodeId });
              }}
              renderHeader={(busy, leave) =>
                renderEditorNavigation("previs", busy, leave)
              }
              beforePublish={async () => {
                await controller.prepareCanvasForAgent();
              }}
              onPublished={(canvas) =>
                controller.client.setQueryData(
                  visualWorkshopQueryKeys.canvas(projectId),
                  canvas,
                )
              }
            />
          </Suspense>
        </div>
      )}
      {adoption && (
        <PrevisReferenceDialog
          value={adoption}
          controller={controller}
          onClose={() => setAdoption(undefined)}
          onAdopted={() => {
            setAdoption(undefined);
            openStoryboard(previsShotId);
          }}
        />
      )}
    </div>
  );
}
