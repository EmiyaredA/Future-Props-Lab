# Agent Note: 视频剪辑工坊独立转场 v1

Status: implemented

## Problem

视频剪辑工坊原先只把淡入/淡出保存在 Clip 的边缘字段中，无法表达两个相邻 Clip 之间的独立接缝转场，也没有统一的转场库、时间线选中态或可复用的预览/导出效果。

## Decision

时间线 JSON 现在包含独立 `transitions` 集合，并通过 `addTransition`、`updateTransition`、`removeTransition` 操作管理接缝和单 Clip 边缘转场。旧的 `transitionIn/transitionOut` 仍被接受并继续由旧渲染路径处理，保证已有项目兼容。

接缝转场只允许绑定同一视觉/混合轨上的相邻 Clip；边缘转场只引用一个视觉 Clip，时长不能超过参与 Clip。分割时出场边界移动到右侧新 Clip，接缝转场的来源引用随边界移动；删除 Clip 会删除悬空转场；混合轨分离时视觉转场不复制到音频 Clip。

共享媒体 evaluator 现在消费独立转场，并为交叉叠化、黑场、白场、左右擦除、缩放、模糊和闪白提供确定性效果。Web 右侧区域增加“属性 / 转场”模式，时间线显示独立转场胶囊与入场/出场标记，面板提供目录、分类、搜索、参数和应用操作。

## Alternatives considered

- **继续扩展 Clip 的 `transitionIn/transitionOut`** — 改动较小，但无法表达接缝对象、独立选中态和两个 Clip 的关系，因此没有采用。
- **使用 ffmpeg 原生 `xfade` 作为唯一实现** — 导出可直接利用滤镜，但会让预览帧、片段导出和逐帧 evaluator 产生第二套语义，因此没有采用。
- **只实现前端面板和假数据** — 能快速展示设计，但会让项目文档、预览和导出不一致，因此没有采用。

## Consequences

- **收益**：新旧时间线兼容；接缝/边缘转场可以统一持久化、撤销、预览和导出；转场 UI 不再挤在 Clip 属性卡片中。
- **代价与已知上限**：v1 限定同轨相邻 Clip 和 8 个效果；视频解码仍以顺序读取为主，接缝预览使用边界帧语义，后续扩展复杂旋转/故障效果时需要继续维护共享 evaluator。

## Verification

- `uv run pytest -q tests/test_video_editor_transitions.py tests/test_video_editor.py tests/test_video_editor_trim.py tests/test_video_editor_ripple.py`：39 passed。
- `npm run test --workspace web -- tests/video-editor-transitions.test.tsx tests/video-editor-timeline.test.tsx tests/video-editor-model.test.ts tests/video-editor-trim.test.tsx`：46 passed。
- `npm run contracts:check`：通过。
- Python 定向 ruff：通过。
- 全量 Web build 仍受工作树中既有的素材组织与测试类型错误阻断，错误未指向本次转场文件。
