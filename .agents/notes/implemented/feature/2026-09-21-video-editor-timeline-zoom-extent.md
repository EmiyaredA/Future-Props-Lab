# Agent Note: 剪辑工坊时间轴缩放跟有效序列时长

Status: implemented

## Problem

时间轴缩放下限曾固定为 `10px/s`。长序列（有效片段出点远大于视窗宽度 / 10）无法再缩小，用户看不到整段轨道内容；短序列又需要保留比「刚好铺满」更疏的空白工作区。

## Decision

缩放范围以**有效序列时长**（各轨片段 `timelineStartUs + durationUs` 的最大值，复用 `timelineDuration`）相对内容视窗宽度为基准：

- `fittedTimelineZoom` = `floor(contentWidthPx / durationSeconds)`，夹在硬下限 `1` 与上限 `240` 之间；
- 滑块下限 `timelineZoomMinimum` = `min(10, fitted)`——短片保持舒适下限 10，长片下探到能铺进当前视窗的比例；
- 「适配宽度」一键设为 `fitted` 并重置横向滚动，对齐 Premiere Zoom to Sequence / FCP·Resolve Shift-Z；
- 持久化允许硬下限 `1`，避免适配后的值被读回抬到 10。

## Alternatives considered

- **只加「适配宽度」、下限仍固定 10** — 一键能看全貌，但滑块仍到不了极限缩小，和用户「按实际长度放缩」的诉求不一致。
- **把 100% 定义为 fit、滑块为相对百分比（Hyperframes）** — 语义更贴近部分现代 NLE，但会改掉现有 `px/s` 显示与偏好存储形状，迁移成本高。
- **一律取消舒适下限、硬下限 1 到底** — 短片缩到极疏时标尺与空白过大，工作区噪音增加；保留 `min(10, fitted)` 兼顾 Premiere「序列变长才放宽缩小」的习惯。

## Consequences

- **收益**：长序列滑到最左或点「适配宽度」即可看见整段有效内容；短序列行为与旧舒适下限一致。
- **代价**：下限随视窗 Resize 与内容时长变化；视窗未测到前暂用舒适下限，测宽后若当前缩放低于新下限会抬升一档。

## Verification

- `web/tests/features/video-editor-timeline-scale.test.ts`：fit / 动态下限 / clamp。
- 手动：放入长于视窗的片段，拖缩放滑块到最左或点「适配宽度」，整段有效内容应落入视窗且不再强制停在 10px/s。
