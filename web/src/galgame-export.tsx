/* eslint-disable react-refresh/only-export-components */
import { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import "@features/galgame-workshop/galgame-workshop.css";
import "./galgame-export.css";

type ExportManifest = {
  document: GalgameStoryProject;
  locale: string;
  branchSelections: Array<{ branchBlockId: string; choiceId: string }>;
  choiceDurationMs: number;
  choiceHighlightMs: number;
  clipRange?: {
    fragmentId: string;
    startMs: number;
    endMs: number;
    captureStartMs?: number;
  };
};

type ExportAudioEvent = {
  action: "play" | "stop";
  channel: "voice" | "bgm" | "ambient" | "sfx" | "video";
  storyAssetId?: string;
  offsetMs?: number;
  volume?: number;
  loop?: boolean;
  fadeMs?: number;
  atMs: number;
};

declare global {
  interface Window {
    __FPL_GALGAME_EXPORT__?: ExportManifest;
    __FPL_EXPORT_STATE__?: {
      ready: boolean;
      complete: boolean;
      ok: boolean;
      label: string;
      startedAt: number;
      endedAt?: number;
      audioEvents: ExportAudioEvent[];
      position?: {
        chapterId: string;
        fragmentId: string;
        positionMs: number;
        blockId?: string;
      };
    };
  }
}

function ExportPlayer({ manifest }: { manifest: ExportManifest }) {
  const selections = useMemo(
    () =>
      Object.fromEntries(
        manifest.branchSelections.map((item) => [
          item.branchBlockId,
          item.choiceId,
        ]),
      ),
    [manifest.branchSelections],
  );
  return (
    <StoryPlayer
      document={manifest.document}
      locale={manifest.locale}
      mode="play"
      viewportPreferences={{
        aspectMode: "16:9",
        customWidth: 16,
        customHeight: 9,
        collapsed: false,
      }}
      exportMode={{
        branchSelections: selections,
        choiceDurationMs: manifest.choiceDurationMs,
        choiceHighlightMs: manifest.choiceHighlightMs,
        timelineRange: manifest.clipRange
          ? {
              fragmentId: manifest.clipRange.fragmentId,
              startMs:
                manifest.clipRange.captureStartMs ?? manifest.clipRange.startMs,
              endMs: manifest.clipRange.endMs,
            }
          : undefined,
        onProgress: (position) => {
          if (window.__FPL_EXPORT_STATE__)
            window.__FPL_EXPORT_STATE__.position = position;
        },
        onComplete: ({ ok, label }) => {
          if (!window.__FPL_EXPORT_STATE__) return;
          window.__FPL_EXPORT_STATE__.complete = true;
          window.__FPL_EXPORT_STATE__.ok = ok;
          window.__FPL_EXPORT_STATE__.label = label;
          window.__FPL_EXPORT_STATE__.endedAt = performance.now();
        },
        onAudioEvent: (event) => {
          const state = window.__FPL_EXPORT_STATE__;
          if (!state) return;
          state.audioEvents.push({
            ...event,
            atMs: Math.max(0, performance.now() - state.startedAt),
          });
        },
      }}
    />
  );
}

const manifest = window.__FPL_GALGAME_EXPORT__;
window.__FPL_EXPORT_STATE__ = {
  ready: false,
  complete: false,
  ok: false,
  label: "",
  startedAt: 0,
  audioEvents: [],
};

const root = createRoot(document.getElementById("root")!);

async function preloadAssets(value: ExportManifest) {
  const fileIds = Array.from(
    new Set(
      (value.document.assets ?? [])
        .map((asset) => asset.fileId)
        .filter((fileId): fileId is string => Boolean(fileId)),
    ),
  );
  await Promise.all(
    fileIds.map(async (fileId) => {
      const response = await fetch(
        `/v1/files/${encodeURIComponent(fileId)}/content`,
      );
      if (!response.ok) throw new Error(`素材预加载失败：${fileId}`);
      await response.arrayBuffer();
    }),
  );
  await document.fonts.ready;
}

async function start() {
  if (!manifest) {
    root.render(<main className="galgame-export-error">缺少导出清单</main>);
    return;
  }
  try {
    await preloadAssets(manifest);
    const state = window.__FPL_EXPORT_STATE__!;
    state.startedAt = performance.now();
    state.ready = true;
    root.render(<ExportPlayer manifest={manifest} />);
  } catch (reason) {
    const state = window.__FPL_EXPORT_STATE__!;
    state.ready = true;
    state.complete = true;
    state.ok = false;
    state.label = reason instanceof Error ? reason.message : "素材预加载失败";
  }
}

void start();
