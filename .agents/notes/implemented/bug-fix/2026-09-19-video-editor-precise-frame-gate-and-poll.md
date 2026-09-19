# Agent Note: 精确停帧门控与编辑页轮询清理

Status: implemented

## Problem

暂停或拖动时间轴时，节目监视器仍会请求后端精确帧，即使界面「精确停帧」已关闭：`<img>` 只判断 `!playing`，不看 `preciseFrame`。未命中缓存时走 FFmpeg 合成（含抠像），拖 scrub 会把整页拖慢。同时 `useVideoEditor` 每 1.2s 轮询 renders，编辑页并不消费该数据，却周期性重渲染素材/时间轴/监视器。

## Decision

精确停帧图仅在 `preciseFrame && !playing && !draggingText` 时挂载；关闭后暂停与 scrub 只走代理视频与浏览器抠像。从 `useVideoEditor` 移除未使用的 renders 查询与固定 1.2s 轮询；任务中心页继续自行轮询。默认偏好仍为开启精确停帧。

关联：[视频编辑器抠像预览按帧调度](2026-09-19-video-editor-chroma-preview-frame-schedule.md)。

## Alternatives considered

- **保留编辑页 renders 查询但仅在有 running 任务时轮询** — 仍无 UI 消费者，多一次无意义订阅。
- **关闭精确停帧时改用节流后的 preview/frame** — 仍占后端；门控关闭后代理预览已够交互。
- **本次一并节流 playhead React 更新** — 与门控/轮询正交，留待实测仍卡时再做。

## Consequences

- **收益**：关掉精确停帧后 scrub 不再打 `/preview/frame`；编辑页空闲不再因无用轮询每 1.2s 整树重渲。
- **代价**：关闭精确停帧时暂停画面与导出像素可能略有差异（代理编解码）；需要导出一致时再打开按钮。

## Verification

`npm run test --workspace web -- tests/video-editor-preview-playback.test.tsx tests/video-editor-playback.test.tsx`
