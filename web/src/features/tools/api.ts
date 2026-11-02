import { type TransferOptions } from "@platform/api/transfer";
import type { components } from "@generated/api";
import {
  api,
  fetchApiDownload,
  fetchApiJson,
  unwrap,
  type ApiDownload,
} from "@platform/api/client";

export type ToolNavigationItem = components["schemas"]["ToolNavigationItemOut"];
export type ToolNavigationState =
  components["schemas"]["ToolNavigationStateOut"];

export type VideoDownloadBinaryStatus = {
  name: string;
  ok: boolean;
  path: string | null;
  version: string | null;
  hint: string | null;
};

export type VideoDownloadDeps = {
  ready: boolean;
  yt_dlp: VideoDownloadBinaryStatus;
  ffmpeg: VideoDownloadBinaryStatus;
};

export type VideoDownloadQuality = "best" | "1080" | "720" | "480";
export type VideoDownloadBrowser =
  "chrome" | "chromium" | "edge" | "safari" | "brave" | "firefox";

export type VideoDownloadJobCreate = {
  url: string;
  quality: VideoDownloadQuality;
  use_browser_cookies: boolean;
  cookies_from_browser: VideoDownloadBrowser;
  save_to_disk: boolean;
  save_to_library: boolean;
  folder_id?: string | null;
};

export type VideoDownloadAsset = {
  id: string;
  display_name: string;
  original_filename: string;
  mime_type: string;
  byte_size: number;
};

export type VideoDownloadJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  url: string;
  quality: string;
  use_browser_cookies: boolean;
  cookies_from_browser: string | null;
  save_to_disk: boolean;
  save_to_library: boolean;
  title: string | null;
  filename: string | null;
  byte_size: number | null;
  error: string | null;
  asset: VideoDownloadAsset | null;
  created_at: string;
  updated_at: string;
};

export async function getToolNavigationState(): Promise<ToolNavigationState> {
  return unwrap(await api.GET("/v1/tool-navigation/state"));
}

export async function setToolFavorite(
  toolId: string,
  isFavorite: boolean,
): Promise<ToolNavigationItem> {
  return unwrap(
    await api.PATCH("/v1/tool-navigation/tools/{tool_id}", {
      params: { path: { tool_id: toolId } },
      body: { is_favorite: isFavorite },
    }),
  );
}

export async function recordToolUse(
  toolId: string,
): Promise<ToolNavigationItem> {
  return unwrap(
    await api.POST("/v1/tool-navigation/tools/{tool_id}/use", {
      params: { path: { tool_id: toolId } },
    }),
  );
}

export async function getVideoDownloadDeps(): Promise<VideoDownloadDeps> {
  return fetchApiJson<VideoDownloadDeps>(
    "/v1/tool-navigation/video-download/deps",
  );
}

export async function createVideoDownloadJob(
  body: VideoDownloadJobCreate,
): Promise<VideoDownloadJob> {
  return fetchApiJson<VideoDownloadJob>(
    "/v1/tool-navigation/video-download/jobs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function getVideoDownloadJob(
  jobId: string,
): Promise<VideoDownloadJob> {
  return fetchApiJson<VideoDownloadJob>(
    `/v1/tool-navigation/video-download/jobs/${encodeURIComponent(jobId)}`,
  );
}

export async function downloadVideoDownloadFile(
  jobId: string,
  transfer: TransferOptions = {},
): Promise<ApiDownload> {
  return fetchApiDownload(
    `/v1/tool-navigation/video-download/jobs/${encodeURIComponent(jobId)}/file`,
    transfer,
  );
}
