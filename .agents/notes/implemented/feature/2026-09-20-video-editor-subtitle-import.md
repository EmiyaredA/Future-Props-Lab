# Agent Note: 视频剪辑工坊字幕文件导入

Status: implemented

## Problem

视频剪辑工坊已经支持文字 Clip、统一文字渲染、时间轴 CAS 和撤销，但字幕仍需逐条手动创建。字幕文件中的时间码、换行和大量条目无法高效进入现有时间线。

## Decision

视频编辑器在“添加文字”菜单中支持 SRT、VTT 和 ASS。前端负责解析时间与文本，在导入预览中报告格式错误、空文本、非法时间和重叠条目，并允许选择保留原始时间码或将首条字幕平移到当前播放头。确认后复用现有 `reorderTrack` 与 `addTrack` 时间轴操作，一次创建独立的“字幕”视觉轨和文字 Clip；ASS 的高级样式统一降级为编辑器现有字幕样式。

字幕源文件不作为素材资产保存，也不新增后端 API、数据库字段或迁移。解析结果直接写入时间轴文档，确保字幕与现有文字 Clip 使用同一套预览、导出、编辑和撤销语义。

## Alternatives considered

- **新增后端字幕导入 API**：可以统一解析和校验，但会引入不必要的网络契约与服务端文本解析；现有 `addTrack` 已能原子保存大量文字 Clip，因此不采用。
- **把字幕文件作为视频编辑器素材资产**：能保留源文件，但当前素材处理链面向媒体/字体，字幕不需要代理、缩略图或异步任务，会扩大资产生命周期而没有编辑收益。
- **保留 ASS 的逐条高级样式**：更接近原文件，但需要把 ASS 样式、位置、动画映射到有限的文字 Clip 契约；第一版优先保证跨格式稳定和可编辑。

## Consequences

- 有效字幕都成为普通文字 Clip，可继续移动、裁切、编辑、预览、导出和撤销。
- 非法或重叠 Cue 在预览阶段跳过并展示警告；双语换行保留在同一个 Clip 中。
- 每次导入新增一个置顶字幕轨，撤销批次删除该轨并恢复原有轨道顺序。
- ASS 的字体、颜色、位置、动画等高级样式不保留，统一使用白字、黑边、底部居中的编辑器字幕样式。

## Verification

- `web/tests/features/video-editor-subtitle-import.test.tsx`、`web/tests/features/video-editor-assets.test.tsx`、`web/tests/features/video-editor-text.test.tsx`：37 项通过。
- `tests/apps/video_editor/test_video_editor.py`、`tests/apps/video_editor/test_video_editor_text.py`：29 项通过，包含 220 条文字 Clip 的单次 `addTrack` 保存/重读和重叠拒绝。
- 本次新增前端文件的 ESLint 与 Prettier 检查通过；Web contracts check 通过。
- 项目级 lint、format、build 仍受工作区既有 Amadeus/其他未提交改动和本机 `uv` 缓存权限影响，详见交付说明。
