# Agent Note: 时间轴多选工具栏与右键操作

Status: implemented

## Problem

时间轴已有 `selectedClipIds`、Cmd/Ctrl 点选、框选与整组拖动，右侧也有批量属性面板，但工具栏「分割 / 复制 / 删除 / 波纹删除」与右键菜单仍只吃主选；右键还会强制 `selectClip(clip.id)` 打散多选。剪贴板也是单片段快照，无法整组复制粘贴。

## Decision

工具栏与右键对 `selectedClipIds` 整组生效：删除 / 波纹删除（同轨按 `timelineStartUs` 降序）、分割（仅播放头相交子集，link 组仍走单条 `splitClip`）、静音、导出视频片段、分离轨道。右键目标已在选区中时不塌缩选区；未选中则先单选再开菜单。

应用内剪贴板改为 `VideoEditorClip[]`：复制写入整组快照；粘贴以最早片段落到播放头、其余保留相对偏移；任一条重叠则整批失败。仍清 `linkGroupId`、重生 keyframe id，不写系统剪贴板、不扩后端 multi-id op。单次条数沿用 `BATCH_OPS_LIMIT`（200）。

## Alternatives considered

- **仅修工具栏、右键继续打散多选** — 用户截图里的痛点正是右键后多选丢失，半套改动不够。
- **新增后端 `removeClips` / `splitClips` 批量 op** — 与现有 CAS batch 重复；前端组 redo/undo 数组即可。
- **粘贴时自动重建 A/V link 组** — 复制粘贴 note 已明确不跟 link；多选扩展保持同一边界。

## Consequences

- **收益**：多选后工具栏与右键行为与拖动 / 批量 Inspector 一致；短字幕等可整组复制到播放头。
- **代价**：波纹删除多选依赖 op 顺序；超 200 条需分批。单片段剪贴板契约见[片段复制粘贴](2026-09-19-video-editor-clip-copy-paste.md)，现由本 note 扩展为数组。

## Verification

- `web/tests/video-editor-clipboard.test.ts`：多片段相对粘贴、重叠整批失败。
- `web/tests/video-editor-timeline.test.tsx`：多选删除、右键不打散并整组复制、多选分割仅切相交项。
