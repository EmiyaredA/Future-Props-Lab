import {
  ArrowLeft,
  CircleQuestionMark,
  Clipboard,
  Copy,
  Focus,
  FolderCog,
  FolderOpen,
  Grid2X2,
  Hand,
  Image,
  List,
  MessageSquareText,
  Minus,
  MousePointer2,
  Music,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Type,
  Upload,
  Video,
  X,
} from "lucide-react";
import { AssetBrowser } from "@features/files";
import { ProjectAssistantPanel } from "@features/visual-workshop/assistant/ProjectAssistantPanel";
import { CanvasNodeInspector } from "@features/visual-workshop/canvas/CanvasNodeInspector";
import {
  DEFAULT_VIEWPORT,
  nodeLabel,
} from "@features/visual-workshop/canvas/geometry";
import type { VisualCanvasNode } from "@features/visual-workshop/api";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { useVisualCanvasController } from "@features/visual-workshop/canvas/useVisualCanvasController";
import "@features/visual-workshop/visual-workshop.css";

type MediaNode = Exclude<VisualCanvasNode, { kind: "text" }>;
type PreviewSource = {
  assetId: string | null;
  kind: MediaNode["kind"];
  fallback: boolean;
};

function previewSourceForNode(node: MediaNode): PreviewSource {
  if (node.asset_id) {
    return { assetId: node.asset_id, kind: node.kind, fallback: false };
  }
  if (node.kind === "image" && node.generation_draft?.reference_asset_id) {
    return {
      assetId: node.generation_draft.reference_asset_id,
      kind: "image",
      fallback: true,
    };
  }
  if (node.kind === "video" && node.generation_draft) {
    const draft = node.generation_draft;
    const imageId =
      draft.first_frame_asset_id ??
      draft.reference_asset_ids?.[0] ??
      draft.last_frame_asset_id;
    if (imageId) return { assetId: imageId, kind: "image", fallback: true };
    const videoId = draft.video_asset_ids?.[0];
    if (videoId) return { assetId: videoId, kind: "video", fallback: true };
  }
  return { assetId: null, kind: node.kind, fallback: false };
}

function CanvasMediaPreview({ node }: { node: MediaNode }) {
  const preview = previewSourceForNode(node);
  const { url, error } = useApiBlobUrl(
    preview.assetId ? `/v1/files/${preview.assetId}/content` : null,
  );
  const missing = Boolean(error);

  if (url && preview.kind === "image")
    return (
      <img
        src={url}
        alt={preview.fallback ? "生成参考素材预览" : ""}
        draggable={false}
      />
    );
  if (url && preview.kind === "video") return <video src={url} controls />;
  if (url && preview.kind === "audio") return <audio src={url} controls />;
  const Icon =
    node.kind === "image" ? Image : node.kind === "video" ? Video : Music;
  return (
    <div className={`canvas-media-placeholder${missing ? " is-missing" : ""}`}>
      <Icon aria-hidden />
      <span>
        {missing ? "素材已删除" : `选择或上传${nodeLabel(node.kind)}`}
      </span>
    </div>
  );
}

export function VisualWorkshopCanvasView({
  controller,
}: {
  controller: ReturnType<typeof useVisualCanvasController>;
}) {
  const {
    projectId,
    onBack,
    onAssets,
    surface,
    uploadInput,
    pan,
    revisionRef,
    nodesRef,
    conflictRef,
    saveFailureRef,
    autoSave,
    clipboard,
    uploadPosition,
    viewport,
    setViewport,
    nodes,
    setNodes,
    selectedId,
    setSelectedId,
    mediaEditorTab,
    setMediaEditorTab,
    contextMenu,
    setContextMenu,
    assetsOpen,
    setAssetsOpen,
    assistantOpen,
    setAssistantOpen,
    assetTab,
    setAssetTab,
    assetView,
    setAssetView,
    editingTitle,
    setEditingTitle,
    title,
    setTitle,
    saveState,
    setSaveState,
    saveMessage,
    conflict,
    setConflict,
    projectQuery,
    canvasQuery,
    enqueueSave,
    prepareCanvasForAgent,
    patchNode,
    linkGenerationTask,
    renameMutation,
    upload,
    setZoom,
    createNode,
    removeNode,
    pasteNode,
    fitView,
    onSurfacePointerDown,
    onSurfacePointerMove,
    stopPan,
    startNodeDrag,
    moveNode,
    stopNodeDrag,
    openContextMenu,
    selectedMedia,
  } = controller;
  if (projectQuery.isLoading || canvasQuery.isLoading)
    return (
      <div className="canvas-state">
        <strong>正在打开画布…</strong>
      </div>
    );
  if (projectQuery.isError || !projectQuery.data || canvasQuery.isError)
    return (
      <div className="canvas-state">
        <strong>项目不存在或暂时无法读取</strong>
        <button onClick={onBack}>
          <ArrowLeft aria-hidden />
          返回项目列表
        </button>
      </div>
    );

  return (
    <div className={`visual-canvas${assistantOpen ? " has-assistant" : ""}`}>
      <header className="visual-canvas-topbar">
        <div className="canvas-project-identity">
          <img
            className="canvas-brand-mark"
            src="/brand/visual-workshop-mark-cutout.png"
            alt=""
          />
          <button aria-label="返回项目列表" onClick={onBack}>
            <ArrowLeft aria-hidden />
          </button>
          {editingTitle ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (title.trim()) renameMutation.mutate();
              }}
            >
              <input
                autoFocus
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => {
                  if (title.trim() && title !== projectQuery.data.title)
                    renameMutation.mutate();
                  else setEditingTitle(false);
                }}
              />
            </form>
          ) : (
            <button
              className="canvas-title"
              onClick={() => setEditingTitle(true)}
            >
              {projectQuery.data.title}
              <Pencil aria-hidden />
            </button>
          )}
          <span className={`canvas-save-state ${saveState}`} role="status">
            <Save aria-hidden />
            {saveState === "saving"
              ? "保存中"
              : saveState === "saved"
                ? "已保存"
                : saveState === "conflict"
                  ? "存在冲突"
                  : "保存失败"}
          </span>
        </div>
        <div className="canvas-top-actions">
          <ThemeToggle />
          <button
            className={
              assistantOpen
                ? "active canvas-assistant-trigger"
                : "canvas-assistant-trigger"
            }
            aria-label="对话"
            aria-expanded={assistantOpen}
            onClick={() => setAssistantOpen((value) => !value)}
          >
            <MessageSquareText aria-hidden />
            对话
          </button>
        </div>
      </header>
      <nav className="canvas-tool-dock" aria-label="画布工具">
        <button
          className={assetsOpen ? "active" : ""}
          aria-label="素材库"
          title="素材库"
          onClick={() => {
            setSelectedId(undefined);
            setAssetsOpen((value) => !value);
          }}
        >
          <FolderOpen aria-hidden />
        </button>
        <button aria-label="管理素材" title="管理素材" onClick={onAssets}>
          <FolderCog aria-hidden />
        </button>
      </nav>
      <div
        ref={surface}
        className={`visual-canvas-surface${pan.current ? " is-dragging" : ""}`}
        style={{
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
        }}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onSurfacePointerMove}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        onContextMenu={openContextMenu}
      >
        <div
          className="visual-canvas-world"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          {nodes.map((node) => {
            const selected = node.id === selectedId;
            return (
              <article
                className={`canvas-node ${node.kind}${selected ? " selected" : ""}`}
                style={{ left: node.position.x, top: node.position.y }}
                data-node-id={node.id}
                key={node.id}
                onPointerDown={(event) => startNodeDrag(event, node)}
                onPointerMove={moveNode}
                onPointerUp={stopNodeDrag}
                onPointerCancel={stopNodeDrag}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedId(node.id);
                  setAssetsOpen(false);
                  if (
                    (node.kind === "image" || node.kind === "video") &&
                    selectedId !== node.id
                  ) {
                    setMediaEditorTab("generate");
                  }
                }}
              >
                <header>
                  {node.kind === "image" ? (
                    <Image className="canvas-node-kind-icon" aria-hidden />
                  ) : node.kind === "video" ? (
                    <Video className="canvas-node-kind-icon" aria-hidden />
                  ) : null}
                  {selected ? (
                    <input
                      aria-label="节点标题"
                      maxLength={120}
                      value={node.title}
                      onPointerDown={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        patchNode(node.id, { title: event.target.value })
                      }
                      onBlur={() => {
                        if (autoSave.current) clearTimeout(autoSave.current);
                        enqueueSave(nodesRef.current);
                      }}
                    />
                  ) : (
                    <strong>{node.title}</strong>
                  )}
                  {!selected &&
                  (node.kind === "image" || node.kind === "video") ? (
                    <Pencil className="canvas-node-title-edit" aria-hidden />
                  ) : null}
                  {selected ? (
                    <span className="canvas-node-actions">
                      <button
                        aria-label="复制节点"
                        title="复制节点"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          clipboard.current = structuredClone(node);
                        }}
                      >
                        <Copy aria-hidden />
                      </button>
                      <button
                        aria-label="删除节点"
                        title="删除节点"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeNode(node.id);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </button>
                    </span>
                  ) : null}
                </header>
                {node.kind === "text" ? (
                  <textarea
                    aria-label={`${node.title}内容`}
                    maxLength={20_000}
                    placeholder="输入文本…"
                    value={node.text}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      patchNode(node.id, { text: event.target.value })
                    }
                    onBlur={() => {
                      if (autoSave.current) clearTimeout(autoSave.current);
                      enqueueSave(nodesRef.current);
                    }}
                  />
                ) : (
                  <div className="canvas-node-media">
                    <CanvasMediaPreview node={node} />
                    {node.kind === "image" || node.kind === "video" ? (
                      <button
                        type="button"
                        className="canvas-media-replace"
                        aria-label={
                          node.asset_id
                            ? `替换${nodeLabel(node.kind)}素材`
                            : `选择${nodeLabel(node.kind)}素材`
                        }
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(node.id);
                          setMediaEditorTab("content");
                          setAssetsOpen(false);
                        }}
                      >
                        <RefreshCw aria-hidden />
                        {node.asset_id ? "替换" : "选择素材"}
                      </button>
                    ) : null}
                  </div>
                )}
                {node.kind === "image" || node.kind === "video" ? (
                  <>
                    <span
                      className="canvas-node-port is-input"
                      aria-hidden="true"
                    >
                      <Plus />
                    </span>
                    <span
                      className="canvas-node-port is-output"
                      aria-hidden="true"
                    >
                      <Plus />
                    </span>
                  </>
                ) : null}
                {selected &&
                (node.kind === "image" || node.kind === "video") ? (
                  <CanvasNodeInspector
                    embedded
                    initialTab={mediaEditorTab}
                    projectId={projectId}
                    node={node}
                    onClose={() => setSelectedId(undefined)}
                    onPrepareCanvas={prepareCanvasForAgent}
                    onPatch={(patch, immediate) =>
                      patchNode(node.id, patch, immediate)
                    }
                    onTaskLinked={(taskId) =>
                      linkGenerationTask(node.id, taskId)
                    }
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
      <input
        ref={uploadInput}
        hidden
        multiple
        type="file"
        accept="image/*,video/*,audio/*"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          if (files.length) upload.mutate(files);
          event.currentTarget.value = "";
        }}
      />
      {contextMenu ? (
        <div
          className="canvas-context-menu"
          role="menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            role="menuitem"
            onClick={() => {
              uploadPosition.current = {
                x: contextMenu.worldX,
                y: contextMenu.worldY,
              };
              setContextMenu(undefined);
              uploadInput.current?.click();
            }}
          >
            <Upload aria-hidden /> 上传
          </button>
          <button
            role="menuitem"
            onClick={() =>
              createNode("text", {
                x: contextMenu.worldX,
                y: contextMenu.worldY,
              })
            }
          >
            <Type aria-hidden /> 添加文本节点
          </button>
          <button
            role="menuitem"
            onClick={() =>
              createNode("image", {
                x: contextMenu.worldX,
                y: contextMenu.worldY,
              })
            }
          >
            <Image aria-hidden /> 添加图片节点
          </button>
          <button
            role="menuitem"
            onClick={() =>
              createNode("video", {
                x: contextMenu.worldX,
                y: contextMenu.worldY,
              })
            }
          >
            <Video aria-hidden /> 添加视频节点
          </button>
          <button
            role="menuitem"
            onClick={() =>
              createNode("audio", {
                x: contextMenu.worldX,
                y: contextMenu.worldY,
              })
            }
          >
            <Music aria-hidden /> 添加音频节点
          </button>
          <button role="menuitem" onClick={() => fitView()}>
            <Focus aria-hidden /> 适应屏幕
          </button>
          <i aria-hidden />
          <button
            role="menuitem"
            disabled={!clipboard.current}
            onClick={() =>
              pasteNode({ x: contextMenu.worldX, y: contextMenu.worldY })
            }
          >
            <Clipboard aria-hidden /> 粘贴
          </button>
        </div>
      ) : null}
      {assetsOpen ? (
        <aside className="canvas-assets-drawer" aria-label="项目素材库">
          <header>
            <div className="canvas-assets-title">
              <strong>素材库</strong>
              <span title="管理本项目素材，或从其他项目导入">
                <CircleQuestionMark aria-hidden />
              </span>
            </div>
            <div className="canvas-assets-header-actions">
              <div
                className="file-view-toggle"
                role="group"
                aria-label="文件视图"
              >
                <button
                  type="button"
                  aria-label="卡片视图"
                  aria-pressed={assetView === "grid"}
                  className={assetView === "grid" ? "active" : ""}
                  onClick={() => setAssetView("grid")}
                >
                  <Grid2X2 aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="列表视图"
                  aria-pressed={assetView === "list"}
                  className={assetView === "list" ? "active" : ""}
                  onClick={() => setAssetView("list")}
                >
                  <List aria-hidden />
                </button>
              </div>
              <button
                className="canvas-assets-close"
                aria-label="关闭素材库"
                onClick={() => setAssetsOpen(false)}
              >
                <X aria-hidden />
              </button>
            </div>
          </header>
          <nav className="canvas-assets-tabs" role="tablist">
            <button
              className={assetTab === "project" ? "active" : ""}
              role="tab"
              aria-selected={assetTab === "project"}
              onClick={() => setAssetTab("project")}
            >
              本项目
            </button>
            <button
              className={assetTab === "library" ? "active" : ""}
              role="tab"
              aria-selected={assetTab === "library"}
              onClick={() => setAssetTab("library")}
            >
              跨项目
            </button>
          </nav>
          {assetTab === "project" ? (
            <AssetBrowser
              compact
              projectId={projectId}
              viewMode={assetView}
              onViewModeChange={setAssetView}
            />
          ) : (
            <AssetBrowser
              compact
              importMode
              projectId={projectId}
              viewMode={assetView}
              onViewModeChange={setAssetView}
              onImported={() => setAssetTab("project")}
            />
          )}
        </aside>
      ) : null}
      {selectedMedia && selectedMedia.kind === "audio" ? (
        <CanvasNodeInspector
          projectId={projectId}
          node={selectedMedia}
          onClose={() => setSelectedId(undefined)}
          onPatch={(patch, immediate) =>
            patchNode(selectedMedia.id, patch, immediate)
          }
        />
      ) : null}
      <ProjectAssistantPanel
        projectId={projectId}
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        prepareCanvas={prepareCanvasForAgent}
      />
      {conflict ? (
        <div className="canvas-conflict" role="alert">
          <span>
            <strong>画布存在更新冲突</strong>
            本地草稿仍保留，请选择要使用的版本。
          </span>
          <button
            onClick={() => {
              nodesRef.current = conflict.nodes;
              revisionRef.current = conflict.revision;
              conflictRef.current = false;
              saveFailureRef.current = "";
              setNodes(conflict.nodes);
              setConflict(undefined);
              setSaveState("saved");
            }}
          >
            载入服务器版本
          </button>
          <button
            className="danger"
            onClick={() => {
              revisionRef.current = conflict.revision;
              conflictRef.current = false;
              saveFailureRef.current = "";
              setConflict(undefined);
              enqueueSave(nodesRef.current);
            }}
          >
            用本地版本覆盖
          </button>
        </div>
      ) : null}
      {saveMessage ? (
        <div className="canvas-save-error">{saveMessage}</div>
      ) : null}
      <div
        className={`canvas-controls${
          assetsOpen || (selectedMedia && selectedMedia.kind === "audio")
            ? " with-assets"
            : ""
        }`}
        aria-label="画布视图控制"
      >
        <div className="canvas-control-mode" aria-hidden>
          <span className="active">
            <MousePointer2 />
          </span>
          <span>
            <Hand />
          </span>
        </div>
        <i aria-hidden />
        <button aria-label="缩小" onClick={() => setZoom(viewport.zoom - 0.1)}>
          <Minus aria-hidden />
        </button>
        <button
          className="canvas-zoom-value"
          onClick={() => setViewport(DEFAULT_VIEWPORT)}
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button aria-label="放大" onClick={() => setZoom(viewport.zoom + 0.1)}>
          <Plus aria-hidden />
        </button>
        <i aria-hidden />
        <button
          aria-label="适配视图"
          title="适配视图"
          onClick={() => fitView()}
        >
          <Focus aria-hidden />
        </button>
      </div>
    </div>
  );
}
