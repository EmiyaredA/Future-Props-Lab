# Agent Note: 素材默认效果与烘焙

Status: implemented

## Problem

时间线批量抠像只改当前项目中的 clip，无法让素材库中的视频/图片在以后上轨时默认带抠像。用户若要把抠像结果固化为可复用素材，也不应覆盖原始文件。

## Decision

在项目作用域的 `video_editor_asset_metadata.default_effects` JSON 中保存 `chromaKey`（可空）。`PATCH .../assets/{id}` 以 `expectedRevision` 做 CAS，并把 `revision` / `defaultEffects` 暴露在 `VideoEditorAssetOut`。上轨时 [`baseClip`](../../../web/src/features/video-editor/editorModel.ts) 对 video/image 注入该默认抠像。

烘焙通过新任务 kind `asset_bake`：读取默认或请求体内的启用抠像参数，图片走 `apply_chroma_key` 输出 PNG，视频走单 clip `render_document`（1080p30 黑底 H.264）。产出为**新** VisualAsset + 空 `default_effects`，原素材不变；成功后把新 id 插到时间线 `assetOrganization` 中与源相邻的位置。素材库批量工具栏提供「默认抠像」与「烘焙选中」。

## Alternatives considered

- **默认效果写进 timeline 文档** — 与素材生命周期脱节，跨上轨/文件夹难共享。
- **烘焙覆盖源文件** — 破坏非破坏式原则，且影响其他引用。
- **本期引入带 alpha 的视频容器** — 与现有成片 H.264 管线不一致，延后。

## Consequences

- **收益**：素材库可设默认抠像并另存处理后板；与[时间线批量属性面板](2026-09-19-video-editor-batch-inspector.md)边界清晰。
- **代价**：视频烘焙为黑底不透明板；默认效果本期仅 chromaKey；organization 插入在 timeline CAS 冲突时为尽力而为。

## Verification

- `tests/test_video_editor_asset_defaults.py`：CAS 冲突、默认效果写入、图片 bake 产出新素材且 organization 插入。
- `web/tests/video-editor-asset-defaults.test.tsx`：上轨注入 chromaKey。
- `npm run contracts:generate` / `npm run verify-notes`
