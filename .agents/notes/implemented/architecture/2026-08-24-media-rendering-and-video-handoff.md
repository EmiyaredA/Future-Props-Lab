# Agent Note: 确定性媒体渲染与 Galgame 视频交接边界

Status: implemented

## Problem

多个工坊需要帧、时间轴和媒体渲染，直接互相调用会造成业务包反向依赖。

## Decision

确定性时间线画面和视频渲染归 `backend/app/capabilities/media_rendering/`；Galgame 直接导出不依赖视频编辑器，只有显式的视频编辑器交接用例可以跨功能调用共享渲染契约。

## Alternatives considered

- **每个工坊各自实现渲染器** — 初期独立，但会产生不同的时间映射和取消行为。
- **Galgame 直接复用 video_editor 实现** — 可减少代码，却把业务工坊变成公共渲染 owner。

## Consequences

- **收益**：帧求值、变速、取消和输出行为有单一事实源。
- **代价与上限**：跨工坊交接必须显式建模。

## Verification

渲染实现位于 `backend/app/capabilities/media_rendering/`；运行媒体渲染和 Galgame/视频交接测试。

