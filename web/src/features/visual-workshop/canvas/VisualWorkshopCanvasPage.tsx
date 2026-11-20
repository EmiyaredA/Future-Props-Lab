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
import { AcceptanceWorkspace } from "../acceptance/AcceptanceWorkspace";
import { lazy, Suspense, useEffect, useState } from "react";
import { visualWorkshopQueryKeys } from "../queryKeys";
import { nodeLabel } from "./geometry";
import { ProjectBoard } from "@features/visual-workshop/board/ProjectBoard";
import { getNodeOutput, type VisualNodeOutput } from "../api";

import type { ScriptSeed } from "../creative/api";

const ScriptWorkspace = lazy(() => import("../creative/ScriptWorkspace"));
const PrevisWorkspace = lazy(() => import("../previs/PrevisWorkspace"));

export function VisualWorkshopCanvasPage(props: VisualWorkshopCanvasPageProps) {
  const [previs, setPrevis] = useState(false);
  const [script, setScript] = useState(false);
  const [previsSeed, setPrevisSeed] = useState<ScriptSeed>();
  const [acceptance, setAcceptance] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState("");
  const [acceptanceEntry, setAcceptanceEntry] = useState<{
    nodeId: string;
    output?: VisualNodeOutput;
    entry: number;
  }>();
  const controller = useVisualCanvasController(props);
  const [historyPreviews, setHistoryPreviews] = useState<{
    projectId: string;
    items: Record<string, VisualNodeOutput | undefined>;
  }>({ projectId: props.projectId, items: {} });
  const [view, setView] = useState<"canvas" | "board">(() =>
    localStorage.getItem(`visual-project-view:${props.projectId}`) === "board"
      ? "board"
      : "canvas",
  );
  const { projectId, projectQuery, title, nodes, selectedId, saveState } =
    controller;
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
        if (dirty) return "dirty";
        await Promise.all([
          refetchProject({ throwOnError: true }),
          refetchCanvas({ throwOnError: true }),
        ]);
        return "updated";
      }),
    [projectId, dirty, refetchProject, refetchCanvas],
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
        unsaved: dirty,
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
          unsaved: dirty,
        },
      }),
    );
  }, [projectId, projectTitle, selected, dirty]);
  const switchView = (next: "canvas" | "board") => {
    localStorage.setItem(`visual-project-view:${props.projectId}`, next);
    setView(next);
    setPrevis(false);
    setScript(false);
    setPrevisSeed(undefined);
  };
  function openPrevis(seed?: ScriptSeed) {
    setPrevisSeed(seed);
    setScript(false);
    setPrevis(true);
  }
  function openScript() {
    setPrevis(false);
    setPrevisSeed(undefined);
    setScript(true);
  }
  const openAcceptance = async (output?: VisualNodeOutput) => {
    try {
      await controller.prepareCanvasForAgent();
      if (output) {
        controller.setSelectedId(output.node_id);
        switchView("board");
        setAcceptanceEntry({
          nodeId: output.node_id,
          output,
          entry: Date.now(),
        });
        setAcceptance(false);
        return;
      }
      setAcceptanceError("");
      setAcceptance(true);
    } catch (error) {
      setAcceptanceError(
        error instanceof Error ? error.message : "请先处理画布保存错误",
      );
    }
  };
  const renderWorkflowHeader = (
    mode: "script" | "previs",
    busy: boolean,
    leave: (action: () => void | Promise<void>) => void,
  ) => (
    <VisualProjectHeader
      activeView={mode}
      onScript={mode === "previs" ? () => leave(openScript) : undefined}
      onPrevis={mode === "script" ? () => leave(() => openPrevis()) : undefined}
      projectTitle={projectQuery.data?.title ?? "创作项目"}
      title={title}
      editingTitle={controller.editingTitle}
      saveState={saveState}
      busy={busy}
      onBack={() => leave(controller.onBack)}
      onCanvas={() => leave(() => switchView("canvas"))}
      onBoard={() => leave(() => switchView("board"))}
      onAcceptance={() => leave(openAcceptance)}
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
  );
  return (
    <>
      {navigation.dialog}
      <TransferFeedback progress={controller.transferProgress} />
      {acceptanceError && (
        <p role="alert" className="acceptance-error">
          {acceptanceError}
        </p>
      )}
      {acceptance && (
        <AcceptanceWorkspace
          key={props.projectId}
          projectId={props.projectId}
          title={controller.projectQuery.data?.title ?? "创作项目"}
          nodes={controller.nodes}
          onOpenNode={(nodeId, outputId) => {
            void (async () => {
              try {
                const output = outputId
                  ? await getNodeOutput(props.projectId, nodeId, outputId)
                  : undefined;
                controller.setSelectedId(nodeId);
                switchView("board");
                setHistoryPreviews((current) => ({
                  projectId: props.projectId,
                  items: {
                    ...(current.projectId === props.projectId
                      ? current.items
                      : {}),
                    [nodeId]: output,
                  },
                }));
                setAcceptanceEntry({ nodeId, output, entry: Date.now() });
                setAcceptance(false);
              } catch (error) {
                setAcceptanceError(
                  error instanceof Error ? error.message : "输出版本读取失败",
                );
              }
            })();
          }}
          onView={(next) => {
            switchView(next);
            setAcceptance(false);
          }}
          onBack={() => setAcceptance(false)}
        />
      )}
      {script && !acceptance && (
        <Suspense fallback={<p role="status">正在打开剧本…</p>}>
          <ScriptWorkspace
            key={projectId}
            project={projectId}
            onPrevis={openPrevis}
            renderHeader={(busy, leave) =>
              renderWorkflowHeader("script", busy, leave)
            }
          />
        </Suspense>
      )}
      {previs && !acceptance && (
        <Suspense fallback={<p role="status">正在打开白模预演…</p>}>
          <PrevisWorkspace
            key={projectId}
            projectId={projectId}
            onBack={() => switchView("canvas")}
            seed={previsSeed}
            renderHeader={(busy, leave) =>
              renderWorkflowHeader("previs", busy, leave)
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
      )}
      <div
        style={{ display: acceptance || previs || script ? "none" : undefined }}
      >
        {view === "board" ? (
          <ProjectBoard
            controller={controller}
            acceptanceEntry={acceptanceEntry}
            onAcceptance={(output) => {
              void openAcceptance(output);
            }}
            onCanvas={() => switchView("canvas")}
            onPrevis={() => openPrevis()}
            onScript={openScript}
            previews={
              historyPreviews.projectId === props.projectId
                ? historyPreviews.items
                : {}
            }
            onPreview={(nodeId, version) =>
              setHistoryPreviews((current) => ({
                projectId: props.projectId,
                items: {
                  ...(current.projectId === props.projectId
                    ? current.items
                    : {}),
                  [nodeId]: version,
                },
              }))
            }
          />
        ) : (
          <VisualWorkshopCanvasView
            controller={controller}
            onAcceptance={() => {
              void openAcceptance();
            }}
            onBoard={() => switchView("board")}
            onPrevis={() => openPrevis()}
            onScript={openScript}
          />
        )}
      </div>
    </>
  );
}
