# Agent Note: 视频编辑器抠像预览按帧调度

Status: implemented

## Problem

启用抠像后，节目监视器播放常明显掉帧：代理预览已有约 960×540 上限，但 `ProxyVideo` 仍用显示器 `requestAnimationFrame` 反复跑 CPU 抠像，且每次 `paintChromaCanvas` 无条件写 `canvas.width`/`height` 清空缓冲。时间轴 playhead 也在约 60Hz 更新 React 状态，加重主线程负载。卡顿更像实时抠像热点，而不是缺少整段预渲染。

## Decision

第一阶段只修实时预览热点：播放中优先 `HTMLVideoElement.requestVideoFrameCallback` 按视频新帧抠像，保留 `loadeddata`/`seeked` 单次刷新，不支持时回退 rAF；同尺寸跳过 canvas 重置并复用 matte/despill 缓冲；DEV 下通过 `globalThis.__VE_CHROMA_PERF__` 静默累计 paints、skippedResizes、skippedDuplicateFrames 与 paint 耗时。不把精确停帧/FFmpeg 单帧接口当作连续播放源。按需预渲染缓存留作第二阶段，仅当多层抠像或特效叠加在本优化后仍明显掉帧时再做。

关联：[视频剪辑抠像与文件夹批量操作](../feature/2026-09-19-video-editor-chroma-folder-batch.md)。

## Alternatives considered

- **先做时间轴短区间预渲染缓存** — 能摊平峰值负载，但改动面大，且单片段抠像卡顿更可能来自每显示帧重复处理同一视频帧；应先把 paint 次数对齐片源帧率。
- **用精确停帧接口逐帧拉图当播放源** — 已有单帧缓存，但未命中会走 FFmpeg，不适合流畅连续播放。
- **继续用显示器 rAF 抠像、只降分辨率** — 宽边已 cap 960；60Hz 重复处理同一帧仍浪费主线程。
- **本次一并节流 playhead React 更新** — 与抠像调度正交，先验证按帧 paint 收益，避免一次改两条时钟路径。

## Consequences

- **收益**：30fps 代理片从约 60 次/秒抠像降到约片源帧率；同尺寸不再每帧清空 canvas；DEV 可在控制台读 `__VE_CHROMA_PERF__` 核对 paints 与耗时。
- **代价与上限**：rVFC 回调仍在主线程，多层同时抠像仍可能掉帧；playhead UI 仍约 60Hz；预渲染与 playhead 节流未做。导出与精确停帧路径不变。

## Verification

`npm run test --workspace web -- tests/video-editor-chroma.test.tsx tests/video-editor-preview-playback.test.tsx`
