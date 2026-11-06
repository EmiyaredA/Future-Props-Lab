# Agent Note: 成片导出解码器用 trim 精定位，避免入点前泄漏

Status: implemented

相关：[`2026-09-22-video-editor-export-internal-chunk-seek.md`](./2026-09-22-video-editor-export-internal-chunk-seek.md)、[`2026-09-22-video-editor-export-transition-local-time.md`](./2026-09-22-video-editor-export-transition-local-time.md)

## Problem

取消 30 秒切段后，「粗 input `-ss` + 精确 output `-ss` + `setpts`/`fps` rawvideo」仍会在 B 帧源上把预卷帧泄进管道：片头相对 `sourceInUs` 偏早约 0.85s（监视器没有、成片却有入点前画面）；接缝换 Clip 重新 `open` 解码器时同样偏早，约 43s 等 crossfade 处像回跳。节目监视器用 HTML5 `currentTime` 精确，预览与导出不一致。

## Decision

解码器改为 **粗 input `-ss`（可选 10s 预卷）+ filtergraph `trim=start=fine`，再 `setpts` / `fps` / `format=rgba`**，不再在 `-i` 之后跟 fine `-ss`。`_decoder_seek_plan` / `_decoder_seek_args` / `_decoder_video_filter` 表达该契约；clip-local `open/hold/advance` 与单次连续成片编码保持不变。

## Alternatives considered

- **继续用 `-i` 后的 fine `-ss`** — 与 `setpts`/`fps` 管道组合会泄漏预卷，片头与接缝复现，因此放弃。
- **只用精确 input `-ss`（依赖默认 accurate_seek）** — 对本素材可用，但长 `sourceIn`（千秒级）每次从目标前一关键帧起丢弃的成本不透明；保留粗 seek + trim 既加速又在滤镜图内对齐。
- **逐帧 ffmpeg 精确停帧当导出源** — 语义最稳但整片过慢，因此仍用顺序管道，只修打开定位。

## Consequences

- **收益**：片头与接缝换 Clip 的首帧贴近 `sourceIn + local`；与预览一致。
- **代价**：粗 seek 后 `trim` 依赖 seek 后时间轴从近 0 起算（当前 FFmpeg 转码行为）；若上游改时间戳语义需重验。
- **部分取代**：[`2026-09-22-video-editor-export-internal-chunk-seek.md`](./2026-09-22-video-editor-export-internal-chunk-seek.md) 仍负责「取消 30s 切段」；其中「精确用 output `-ss`」的精定位机制由本篇接管。

## Verification

- `uv run pytest -q tests/apps/media_rendering/test_media_rendering_cancellation.py tests/apps/video_editor/test_video_editor_transitions.py`
- `npm run verify-notes`
- 对本项目 `sourceInUs=82099179` 开解码器取首帧，应贴近入点而非约 81.25s 双剪影；重启后端后重新导出验证片头与约 43s / 2min。
