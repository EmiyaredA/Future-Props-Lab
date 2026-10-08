---
name: future-props-lab-automation
description: Automates the Future Props Lab desktop App with fpl CLI and Python SDK—workshop projects, files library, standalone inference, integrations, and read-only call logs. Use when connecting to the desktop App, creating/editing workshop content, exporting, or investigating model calls; then open the matching skills/ leaf skill.
---

# future-props-lab-automation（总 skill）

## 边界

- **只**通过 `fpl` CLI 或 `future_props_lab` Python SDK 调用已开放的 `resource.method`。
- **不要**修改 Future Props Lab 仓库源码、迁移或配置真源。
- 优先桌面 Agent 白名单（工坊、文件库、独立推理、集成、日志只读）。
- 不覆盖账号治理、模型目录、playground。
- 契约细节以 `fpl operations` 为准；叶子 skill 已内联最小可运行示例。

## 如何使用本包

1. 先读本文件，确认任务落在哪一类。
2. **打开并遵循**对应子 skill：`skills/<路径>/SKILL.md`（下面路由表）。
3. 未配对时先按 `skills/foundation/fpl-connect`；写入约定见 `skills/foundation/fpl-contracts`。

### 单独安装

每个叶子目录（含 `SKILL.md`，且**目录名 = frontmatter `name`**）可单独拷贝到 Agent 的 skills 根目录，例如：

```bash
cp -R skills/visual-workshop/visual-canvas-editing ~/.cursor/skills/visual-canvas-editing
```

叶子已内联「前置」；单装时不必先装本总包。需要完整配对/CAS 说明时可再装 `fpl-connect` / `fpl-contracts`。

## 推荐顺序

1. `fpl-connect` → `fpl-contracts`
2. 工坊主页：`workshop-project-library`（思绪改用 `thought-knowledge-library`）
3. 对应应用的编辑 skill，再按需素材 / 导出 / 生成

## 路由表

| 场景 | 阅读 |
|------|------|
| 配对、status、open、CLI vs API Key | `skills/foundation/fpl-connect/SKILL.md` |
| call/wait、revision/CAS、禁止静默重试 | `skills/foundation/fpl-contracts/SKILL.md` |
| 工坊项目库 CRUD、快照、打开页面 | `skills/workshop-home/workshop-project-library/SKILL.md` |
| 演示：改幻灯片 | `skills/presentation-workshop/presentation-slides-editing/SKILL.md` |
| 演示：导出 PPTX | `skills/presentation-workshop/presentation-pptx-export/SKILL.md` |
| 思绪：知识库/目录树 | `skills/thought-workshop/thought-knowledge-library/SKILL.md` |
| 思绪：笔记正文/导出/历史 | `skills/thought-workshop/thought-note-editing/SKILL.md` |
| 思绪：AI 写作流 | `skills/thought-workshop/thought-writing-assistant/SKILL.md` |
| 视觉：画布编辑 | `skills/visual-workshop/visual-canvas-editing/SKILL.md` |
| 视觉：项目素材引用 | `skills/visual-workshop/visual-project-assets/SKILL.md` |
| 视觉：生成任务 | `skills/visual-workshop/visual-generation-tasks/SKILL.md` |
| 视觉：人物与场景替换、监督看板与返修 | `skills/visual-workshop/visual-character-replacement/SKILL.md` |
| Galgame：剧本 | `skills/galgame-workshop/galgame-story-editing/SKILL.md` |
| Galgame：素材 | `skills/galgame-workshop/galgame-project-assets/SKILL.md` |
| Galgame：ASR/转录 | `skills/galgame-workshop/galgame-transcription-asr/SKILL.md` |
| Galgame：快照/视频导出/交接剪辑 | `skills/galgame-workshop/galgame-export-handoff/SKILL.md` |
| 视频：时间轴 | `skills/video-editor/video-timeline-editing/SKILL.md` |
| 视频：媒体素材 | `skills/video-editor/video-media-assets/SKILL.md` |
| 视频：渲染/分段导出 | `skills/video-editor/video-render-export/SKILL.md` |
| 导演台：项目库 | `skills/director-desk/director-project-library/SKILL.md` |
| 导演台：场景工具 | `skills/director-desk/director-scene-tools/SKILL.md` |
| 录音标注：项目与文档 | `skills/audio-annotation/audio-annotation-project-and-document/SKILL.md` |
| 录音标注：段落转录 | `skills/audio-annotation/audio-annotation-segment-transcription/SKILL.md` |
| 文件库 | `skills/cross-cutting/files-library/SKILL.md` |
| 独立模型推理 | `skills/cross-cutting/model-inference/SKILL.md` |
| 调用日志只读 | `skills/cross-cutting/call-logs-readonly/SKILL.md` |
| 集成中心条目管理 | `skills/cross-cutting/integrations-admin/SKILL.md` |
