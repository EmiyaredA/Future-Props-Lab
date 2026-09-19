# Agent Note: 时间线批量属性面板

Status: implemented

## Problem

时间线已支持多选与整组移动，但右侧属性面板仍只编辑主选中片段。用户无法对多个片段统一调音量、静音、画面适配、缩放位置或抠像参数，只能逐个点开覆盖，容易误改未打算动的字段。

## Decision

多选（`selectedClipIds.length > 1`）时右侧切换为批量属性面板；单选仍用原 Inspector。提交走现有 timeline CAS batch，把同一 dirty patch 映射成最多 200 条 `updateClip`，不新增后端多 id op。

只提交用户明确改过的字段：固定音量、相对增减、静音/取消静音、`fitMode`、`transform` 脏子集，以及 `chromaKey` 脏子集（`{ ...defaults, ...clip.chromaKey, ...dirty }` 整对象写入，undo 回 `clip.chromaKey ?? null`）。按 kind 过滤（音量/静音 → video/audio；适配/抠像 → video/image；变换 → 非 audio）；不支持的片段计入跳过反馈。混合值显示「混合」占位，未编辑不写入。音量继续用线性增益 0–4。

抠像提供命名参数预设（绿幕基础、蓝幕基础、高容差绿幕、人像绿幕），与单 clip 共用 [`chromaPresets.ts`](../../../web/src/features/video-editor/chromaPresets.ts) 默认值；点预设写入草稿后仍需「应用到 N 个片段」。批量面板不做吸色。

## Alternatives considered

- **专用 `updateClips` 后端 op** — 能一次传多 id，但与现有单 clip CAS/undo 形状重复，且 200 条 batch 已够用。
- **批量时仍显示主选中完整属性并“应用到全部”** — 易把无关字段整表覆盖到其他片段。
- **音量改用 dB UI** — 提案常见，但预览与 schema 已是线性增益；本期不引入换算层。
- **批量抠像做成生成新素材任务** — 与非破坏式 clip 参数冲突；生成处理后素材留待素材库默认效果阶段。

## Consequences

- **收益**：多选后可安全批量改音量、画面与抠像，且可撤销；与素材库组织批量边界分开。
- **代价**：音量归一化、裁切 inset、批量吸色仍未做；超过 200 条需分批。素材库默认效果与烘焙见[素材默认效果与烘焙](2026-09-19-video-editor-asset-default-effects-bake.md)；素材库组织批量仍与效果批处理分开。

## Verification

- `web/tests/video-editor-batch-inspector.test.tsx`：固定/相对音量、transform/chroma 脏字段合并、kind 跳过、命名预设与音量同批、混合值与应用反馈。
- `npm run verify-notes`
