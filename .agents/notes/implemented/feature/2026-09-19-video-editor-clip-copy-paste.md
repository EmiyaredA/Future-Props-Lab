# Agent Note: 剪辑工坊片段复制粘贴

Status: implemented

## Problem

时间轴工具栏「复制」实际是同轨、紧接原片段后方的立即 `duplicateClip`，没有剪贴板，也没有粘贴。用户要在播放头处复用字幕等片段时，只能手动重建或依赖可能重叠失败的紧接复制。

## Decision

应用内剪贴板保存选中片段快照；「复制」只写入剪贴板，「粘贴」用已有 `addClip`/`removeClip` 落到 `snapUs(playheadUs)`。目标轨优先原轨（存在、未锁、kind 匹配），否则首条兼容未锁轨。粘贴清 `linkGroupId`，并重生 keyframe id。视觉/混合轨客户端先做重叠校验；⌘/Ctrl+C/V 与工具栏、右键共用同一套逻辑。不写系统剪贴板，不扩后端 operation。

## Alternatives considered

- **继续用 duplicateClip 紧接复制** — 与「复制/粘贴」标签不符，无法落到播放头，重叠时易 422。
- **扩展 duplicateClip 支持 playhead/目标轨** — 新增服务端参数，前端已有 `addClip` 足够。
- **写入系统剪贴板** — 易与属性面板文字选区抢 ⌘C，跨应用 MIME 收益低。

## Consequences

- **收益**：字幕等片段可按 NLE 习惯复制后改播放头再粘贴；撤销走现有 undo 栈。
- **代价**：会话内剪贴板；切项目清空；不跟粘贴 A/V link 组。多选整组复制粘贴见[时间轴多选工具栏与右键操作](2026-09-21-video-editor-multiselect-timeline-actions.md)。

## Verification

- `web/tests/video-editor-clipboard.test.ts`：字幕粘贴、锁轨换轨、视觉轨重叠、清除 linkGroupId。
- 手动：选字幕 → 复制 → 移播放头到空白处 → 粘贴；重叠处应提示且不提交。
