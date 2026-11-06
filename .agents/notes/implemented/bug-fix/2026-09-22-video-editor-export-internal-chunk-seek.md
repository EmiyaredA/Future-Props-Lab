# Agent Note: 成片导出内部 30 秒切段造成无转场处画面回溯

Status: implemented

相关：[`2026-09-22-video-editor-export-transition-local-time.md`](./2026-09-22-video-editor-export-transition-local-time.md)

## Problem

用户走「导出视频」完整成片（不是分段导出 UI），在约 1:59–2:00 等位置仍出现与转场回溯相同的画面抖动，时间线上该处并无转场。根因是渲染引擎把成片按每 30 秒切成临时 MP4 再 concat：每个边界会关掉并重建 FFmpeg 管道，且旧实现用输入侧 `-ss`（只落到关键帧），常见 GOP 下会偏早约 1–2 秒，看起来就像突然回到一两秒前再继续。

## Decision

成片改为**单次连续编码**整段画面，不再按 30 秒切临时段与 concat。解码器启动保留「粗 input `-ss` 预卷」；精定位机制后来改为 filtergraph `trim`（不再用 `-i` 后的 fine `-ss`），见 [`2026-09-22-video-editor-export-seek-trim.md`](./2026-09-22-video-editor-export-seek-trim.md)。顺播仍共享同一管道，避免周期性关键帧误差。

## Alternatives considered

- **仅把输入侧 `-ss` 改成输出侧、仍保留 30 秒切段** — 边界不再偏关键帧，但每段仍重开编码器与 concat，仍有接缝风险与重复初始化成本，因此直接取消切段。
- **跨临时段复用解码器状态** — 能减轻回溯，但 concat 接缝与双路径复杂度仍在，不如单次编码直接。
- **把切段间隔加到数分钟** — 只减少发作次数，2 分钟以上成片仍会在边界抖，因此放弃。

## Consequences

- **收益**：完整导出在 30s/60s/90s/120s… 不再出现无转场的关键帧回溯；与「分段导出」产品功能无关。
- **代价**：超长成片的临时画面文件不再拆段，失败时更难从中段续跑（原先也未对用户暴露续跑）；单个 Clip 首次精确定位比纯输入 seek 稍慢，有 10s 预卷限制。
- **后续**：output `-ss` + `setpts`/`fps` 仍会在 B 帧源泄漏入点前画面，精定位改为 `trim`，见 [`2026-09-22-video-editor-export-seek-trim.md`](./2026-09-22-video-editor-export-seek-trim.md)。

## Verification

- `uv run pytest -q tests/apps/media_rendering/test_media_rendering_cancellation.py tests/apps/video_editor/test_video_editor_transitions.py`
- `npm run verify-notes`
