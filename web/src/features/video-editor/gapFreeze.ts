import { unzipSync } from "fflate";
import { fetchApiBlob } from "@platform/api/client";
import { listVideoEditorAssets, uploadVideoEditorAsset } from "./api";
import { clipSourceTimeUs } from "./editorModel";
import { transformAt } from "./transformModel";
import { findTimelineGaps, type TimelineGap } from "./timelineGaps";
import type { TimelineEdit } from "./timelineSaveQueue";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorTimeline,
} from "./types";

/** Freeze only the track's left picture; do not bake other tracks or audio. */
export function freezeGapTemplate(
  left: VideoEditorClip,
  gap: TimelineGap,
): VideoEditorClip {
  return {
    ...structuredClone(left),
    id: crypto.randomUUID(),
    name: `${left.name} · 空隙修复定帧`,
    kind: left.kind === "video" ? "image" : left.kind,
    timelineStartUs: gap.startUs,
    durationUs: gap.durationUs,
    sourceInUs: 0,
    sourceLoop: false,
    playbackRate: 1,
    volume: 0,
    transform: transformAt(left, left.durationUs - 1),
    keyframes: [],
    linkGroupId: null,
    transitionIn: null,
    transitionOut: null,
  };
}

export function freezeSourcePositionMs(
  left: VideoEditorClip,
  asset: VideoEditorAsset,
) {
  const duration = Number(asset.probe?.durationUs);
  const end = clipSourceTimeUs(left, left.durationUs);
  const streams = asset.probe?.streams as
    { codec_type?: string; avg_frame_rate?: string }[] | undefined;
  const rate = streams?.find(
    (stream) => stream.codec_type === "video",
  )?.avg_frame_rate;
  const [numerator, denominator] = (rate ?? "30/1").split("/").map(Number);
  const fps = numerator / (denominator || 1);
  const step = 1_000_000 / (Number.isFinite(fps) && fps > 0 ? fps : 30);
  const last = left.sourceLoop
    ? Math.max(0, end - 1) % duration
    : Math.min(end - 1, duration - 1);
  // The existing source-frame API seeks in milliseconds. Leave one source-frame
  // handle before the exclusive end; timeline boundaries remain exact microseconds.
  return Math.floor(Math.max(left.sourceInUs, last - step) / 1000);
}

export function planFreezeGaps(
  timeline: VideoEditorTimeline,
  assets: VideoEditorAsset[],
  selected: TimelineGap[],
) {
  const gaps = [...new Map(selected.map((gap) => [gap.id, gap])).values()];
  const current = new Map(
    findTimelineGaps(timeline).map((gap) => [gap.id, gap]),
  );
  const issues = new Set<string>();
  const tracks = timeline.document.tracks ?? [];
  for (const gap of gaps) {
    if (!current.has(gap.id)) {
      issues.add("接点已变化，请重新检查并选择空隙");
      continue;
    }
    const track = tracks.find((item) => item.id === gap.trackId)!;
    const left = track.clips!.find((clip) => clip.id === gap.fromClipId)!;
    if (track.locked) issues.add(`轨道「${track.name}」已锁定`);
    if (
      track.clips!.some(
        (clip) =>
          clip.timelineStartUs < gap.endUs &&
          clip.timelineStartUs + clip.durationUs > gap.startUs,
      )
    )
      issues.add(`轨道「${track.name}」填入定帧会与已有片段重叠`);
    if (left.kind !== "color") {
      const asset = assets.find((item) => item.id === left.assetId);
      if (asset?.processingStatus !== "ready")
        issues.add(`素材「${left.name}」尚未准备好`);
      else if (left.kind === "video") {
        const duration = Number(asset.probe?.durationUs);
        if (!Number.isFinite(duration) || duration <= 0)
          issues.add(`素材「${left.name}」长度未知`);
        else if (
          left.sourceInUs >= duration ||
          (!left.sourceLoop &&
            clipSourceTimeUs(left, left.durationUs) > duration)
        )
          issues.add(`素材「${left.name}」末尾超出可用范围`);
      }
    }
  }
  if (gaps.length > 200) issues.add("定帧单批最多处理 200 处，请减少选择");
  return {
    redo: [],
    undo: [],
    issues: [...issues],
    affectedClipIds: gaps.map((gap) => gap.fromClipId),
    durationUs: gaps.reduce((sum, gap) => sum + gap.durationUs, 0),
  };
}

/** Prepare image assets before the single timeline CAS. Preparation never edits clips. */
export async function prepareGapFreezes(
  timeline: VideoEditorTimeline,
  assets: VideoEditorAsset[],
  gaps: TimelineGap[],
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<TimelineEdit> {
  const check = () => {
    signal.throwIfAborted();
    if (!isCurrent())
      throw new Error("接点或素材已变化，未提交修改；请重新检查");
  };
  const plan = planFreezeGaps(timeline, assets, gaps);
  if (plan.issues.length) throw new Error(plan.issues.join("；"));
  const pictures: VideoEditorClip[] = [];
  for (const gap of gaps) {
    check();
    const left = timeline.document
      .tracks!.flatMap((track) => track.clips ?? [])
      .find((clip) => clip.id === gap.fromClipId)!;
    const picture = freezeGapTemplate(left, gap);
    if (left.kind === "video") {
      const asset = assets.find((item) => item.id === left.assetId)!;
      const archive = await fetchApiBlob(
        `/v1/files/${encodeURIComponent(asset.id)}/frames`,
        {
          method: "POST",
          signal,
          body: JSON.stringify({
            positions_ms: [freezeSourcePositionMs(left, asset)],
            max_width: 1920,
            output: "zip",
          }),
          headers: { "Content-Type": "application/json" },
        },
      );
      check();
      const png = Object.values(
        unzipSync(new Uint8Array(await archive.arrayBuffer())),
      )[0];
      if (!png?.length) throw new Error("定帧提取未返回图片，未修改时间线");
      const uploaded = await uploadVideoEditorAsset(
        timeline.projectId,
        new File([new Uint8Array(png)], `${picture.name}.png`, {
          type: "image/png",
        }),
        signal,
      );
      picture.assetId = uploaded.id;
      const deadline = Date.now() + 60_000;
      while (true) {
        check();
        const ready = (
          await listVideoEditorAssets(timeline.projectId, signal)
        ).items.find((item) => item.id === uploaded.id);
        if (ready?.processingStatus === "ready") break;
        if (ready?.processingStatus === "failed" || Date.now() > deadline)
          throw new Error(
            "定帧素材准备失败或超时，时间线未修改；已上传素材可在素材列表核对",
          );
        await new Promise<void>((resolve) => {
          const finish = () => {
            window.clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = window.setTimeout(finish, 500);
          signal.addEventListener("abort", finish, { once: true });
        });
      }
    }
    pictures.push(picture);
  }
  check();
  return {
    redo: pictures.map((clip) => ({ type: "addClip", clip })),
    undo: pictures.map((clip) => ({ type: "removeClip", clipId: clip.id })),
  };
}
