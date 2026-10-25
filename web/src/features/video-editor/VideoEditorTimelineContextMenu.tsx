import { Download } from "lucide-react";
import type { RefObject } from "react";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimelineTransition,
  VideoEditorTrack,
} from "./types";

export type TimelineContextMenuState =
  | {
      kind: "clip";
      clip: VideoEditorClip;
      left: number;
      top: number;
    }
  | {
      kind: "seam";
      fromClipId: string;
      toClipId: string;
      transitionId?: string;
      left: number;
      top: number;
    };

export function VideoEditorTimelineContextMenu({
  contextMenu,
  contextMenuRef,
  transitions,
  tracks,
  hasClipboard,
  onClose,
  selectTransition,
  openClipEdgeTransition,
  commit,
  clipIsMuted,
  toggleClipsMute,
  copyActionClips,
  onCopyClip,
  onPasteClip,
  resolveActionClips,
  deleteSelected,
  exportSelectedVideos,
  onRequestSegmentExport,
  splitSelected,
  separateClips,
  onRequestClipMerge,
}: {
  contextMenu: TimelineContextMenuState;
  contextMenuRef: RefObject<HTMLDivElement | null>;
  transitions: VideoEditorTimelineTransition[];
  tracks: VideoEditorTrack[];
  hasClipboard: boolean;
  onClose: () => void;
  selectTransition?: (
    value?: string,
    target?: { fromClipId?: string; toClipId?: string },
  ) => void;
  openClipEdgeTransition?: (clipId: string, edge: "in" | "out") => void;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  clipIsMuted: (clip: VideoEditorClip) => boolean;
  toggleClipsMute: (clip: VideoEditorClip) => void;
  copyActionClips: (clip: VideoEditorClip) => void;
  onCopyClip?: (clipOrClips?: VideoEditorClip | VideoEditorClip[]) => void;
  onPasteClip?: () => void;
  resolveActionClips: (clip: VideoEditorClip) => VideoEditorClip[];
  deleteSelected: (ripple?: boolean, clips?: VideoEditorClip[]) => void;
  exportSelectedVideos: (clip: VideoEditorClip) => void;
  onRequestSegmentExport?: (clipIds: string[]) => void;
  splitSelected: () => void;
  separateClips: (clip: VideoEditorClip) => void;
  onRequestClipMerge?: (clipIds: string[]) => void;
}) {
  return (
    <div
      className="ve-clip-context-menu"
      role="menu"
      ref={contextMenuRef}
      style={{ left: contextMenu.left, top: contextMenu.top }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {contextMenu.kind === "seam" ? (
        <>
          <button
            role="menuitem"
            onClick={() => {
              selectTransition?.(contextMenu.transitionId, {
                fromClipId: contextMenu.fromClipId,
                toClipId: contextMenu.toClipId,
              });
              onClose();
            }}
          >
            {contextMenu.transitionId ? "编辑片段之间转场" : "添加片段之间转场"}
          </button>
          {contextMenu.transitionId ? (
            <button
              role="menuitem"
              onClick={() => {
                const existing = transitions.find(
                  (item) => item.id === contextMenu.transitionId,
                );
                if (!existing) {
                  onClose();
                  return;
                }
                void commit(
                  [{ type: "removeTransition", transitionId: existing.id }],
                  [{ type: "addTransition", transition: existing }],
                );
                onClose();
              }}
            >
              删除片段之间转场
            </button>
          ) : null}
        </>
      ) : (
        <>
          {onRequestClipMerge ? (
            <button
              role="menuitem"
              onClick={() => {
                onRequestClipMerge(
                  resolveActionClips(contextMenu.clip).map((clip) => clip.id),
                );
                onClose();
              }}
            >
              合并片段
            </button>
          ) : null}
          <button
            role="menuitem"
            onClick={() => toggleClipsMute(contextMenu.clip)}
          >
            {clipIsMuted(contextMenu.clip) ? "取消静音" : "静音"}
          </button>
          {(contextMenu.clip.kind === "video" ||
            contextMenu.clip.kind === "image" ||
            contextMenu.clip.kind === "audio") &&
          openClipEdgeTransition ? (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  openClipEdgeTransition(contextMenu.clip.id, "in");
                  onClose();
                }}
              >
                {contextMenu.clip.transitionIn
                  ? "编辑片段头转场"
                  : "添加片段头转场"}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  openClipEdgeTransition(contextMenu.clip.id, "out");
                  onClose();
                }}
              >
                {contextMenu.clip.transitionOut
                  ? "编辑片段尾转场"
                  : "添加片段尾转场"}
              </button>
            </>
          ) : null}
          <button
            role="menuitem"
            disabled={!onCopyClip}
            onClick={() => {
              copyActionClips(contextMenu.clip);
              onClose();
            }}
          >
            复制片段
          </button>
          <button
            role="menuitem"
            disabled={!hasClipboard || !onPasteClip}
            onClick={() => {
              onClose();
              onPasteClip?.();
            }}
          >
            粘贴片段
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const targets = resolveActionClips(contextMenu.clip);
              onClose();
              deleteSelected(false, targets);
            }}
          >
            删除片段
          </button>
          {resolveActionClips(contextMenu.clip).some(
            (clip) => clip.kind === "video",
          ) && onRequestSegmentExport ? (
            <button
              role="menuitem"
              onClick={() => {
                onClose();
                exportSelectedVideos(contextMenu.clip);
              }}
            >
              <Download aria-hidden /> 导出视频片段
            </button>
          ) : null}
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              splitSelected();
            }}
          >
            在播放头处分割
          </button>
          {resolveActionClips(contextMenu.clip).some((clip) => {
            const sourceTrack = tracks.find(
              (track) => track.id === clip.trackId,
            );
            return clip.kind === "video" && sourceTrack?.kind === "mixed";
          }) ? (
            <button
              role="menuitem"
              onClick={() => separateClips(contextMenu.clip)}
            >
              分离轨道
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
