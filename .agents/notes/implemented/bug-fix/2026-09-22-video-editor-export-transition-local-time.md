# Agent Note: 导出转场忽略 Clip 本地时间导致画面回溯

Status: implemented

相关：[`../feature/2026-09-21-video-editor-transition-dual-model.md`](../feature/2026-09-21-video-editor-transition-dual-model.md)

## Problem

接缝转场（非闪白）在居中窗口内按「窗起点」推进入场素材本地时间，并在窗结束后保持该连续性，避免半段时长跳回。节目监视器按 `localUs` 精确 seek；成片导出却用顺序 FFmpeg 管道，且 `image_for_clip` 忽略 evaluator 传入的 `local_us`，每调用一次只 `next()` 一帧。

后果包括：转场后半段出场应变定格却继续往片尾后解码；分段渲染重启解码器时按 `timelineStart` 对齐，与连续性偏移差半个转场时长，成片上表现为突然回到一两秒前再往下播。预览侧窗后也曾缺少同一连续性，scrub 时可能与导出不一致。

## Decision

导出 `_render_segment` 的视频取帧改为按请求的 clip-local 时间：`open`（seek 重建管道）/ `hold`（定格复用上一帧）/ `advance`（按帧步前进）。决策函数 `_decoder_request_action` 可单测。预览 `previewTransitions.ts` 在非闪白接缝窗结束后补上与 evaluator 相同的 `forceLocalUs = playhead - windowStart` 连续性。

## Alternatives considered

- **导出改为逐帧 ffmpeg seek（与精确停帧相同）** — 语义正确但整片导出过慢，因此只在时间回退或错位时重建管道，顺播仍走 `next()`。
- **取消窗后连续性、入场始终按 timeline-local** — 会在窗结束时把已播过的手柄段再播一遍，正是用户看到的回溯，因此保留连续性并修好取帧。
- **只加长导出分段避免边界** — 治标不治本，定格与窗内错位仍在，因此放弃。

## Consequences

- **收益**：成片与 evaluator/预览对转场本地时间一致；出场定格与按错误 `timelineStart` 重启解码不再制造回溯。
- **代价**：本地时间回退时会重建 FFmpeg 管道，极端 scrub 式访问更贵；正常时间线顺播几乎仍是顺序解码。
- **后续**：完整导出仍曾按内部 30 秒切段 + 输入侧 `-ss` 在无转场处抖一下，见 [`2026-09-22-video-editor-export-internal-chunk-seek.md`](./2026-09-22-video-editor-export-internal-chunk-seek.md)。

## Verification

- `uv run pytest -q tests/test_video_editor_transitions.py tests/test_media_rendering_cancellation.py`
- `npm run test --workspace web -- tests/video-editor-preview-transitions.test.ts`
- `npm run verify-notes`
