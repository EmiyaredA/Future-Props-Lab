# Agent Note: 属性面板恢复片段入/出场转场控件

Status: implemented

相关：[`2026-09-21-video-editor-transition-dual-model.md`](./2026-09-21-video-editor-transition-dual-model.md)

## Problem

双模型把片段转场编辑收进「转场」面板后，属性面板只剩一句跳转文案。用户选中片段后习惯在「属性」里找开关，无法直观取消或改时长，只能猜到要切到「转场」页。

## Decision

视频 / 图片片段的属性面板恢复入场 / 出场卡片：显示效果名、时长、**启用 / 取消**，以及「更换效果…」跳到转场库。默认启用以 `crossfade`。接缝转场仍只在「转场」面板编辑；数据模型仍是 Clip `transitionIn` / `transitionOut`，不收回 `transitions[]`。

## Alternatives considered

- **只加强转场面板文案** — 不能解决「我在属性里找不到」的发现路径，因此放弃。
- **属性里嵌完整效果库** — 与转场面板重复、挤占属性区，因此放弃。

## Consequences

- **收益**：选中片段即可在属性里取消 / 调时长；换效果仍走转场库。
- **代价**：属性与转场面板都可改边字段，需保持同一 `setTransition` 操作。

## Verification

- `npm run test --workspace web -- tests/video-editor-inspector-transitions.test.tsx`
