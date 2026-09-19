# future-props-lab-automation — Future Props Lab 官方自动化 Skill 包

真源目录：[`skills/future-props-lab-automation/`](.)。教 Agent 用 **`fpl` CLI** 与 **Python SDK** 操作本机 App / HTTP API。

## 边界

- 只通过 SDK/CLI 调用已开放的 `resource.method`；**不**修改本仓库源码。
- 优先桌面 Agent 白名单；不含账号治理、模型目录、playground。
- 细节以 `fpl operations` 与各叶子内联示例为准。

## 安装方式

| 方式 | 怎么做 | 说明 |
|------|--------|------|
| **整体** | 将本目录拷到 Agent skills 根 | 发现总 skill，再按路由读包内 `skills/` |
| **单个叶子** | 拷贝包内 `skills/<分类>/<skill-name>/` 到 Agent skills 根下的 `<skill-name>/` | 目录名必须等于 frontmatter `name`；叶子已内联前置，可独立使用 |

```bash
# 单装示例
cp -R skills/foundation/fpl-connect ~/.cursor/skills/fpl-connect
cp -R skills/visual-workshop/visual-canvas-editing ~/.cursor/skills/visual-canvas-editing

# 校验包结构
python3 scripts/validate_skills.py
```

## 子 skill 一览

| 路径 | name |
|------|------|
| `skills/foundation/fpl-connect` | `fpl-connect` |
| `skills/foundation/fpl-contracts` | `fpl-contracts` |
| `skills/workshop-home/workshop-project-library` | `workshop-project-library` |
| `skills/presentation-workshop/presentation-slides-editing` | `presentation-slides-editing` |
| `skills/presentation-workshop/presentation-pptx-export` | `presentation-pptx-export` |
| `skills/thought-workshop/thought-knowledge-library` | `thought-knowledge-library` |
| `skills/thought-workshop/thought-note-editing` | `thought-note-editing` |
| `skills/thought-workshop/thought-writing-assistant` | `thought-writing-assistant` |
| `skills/visual-workshop/visual-canvas-editing` | `visual-canvas-editing` |
| `skills/visual-workshop/visual-project-assets` | `visual-project-assets` |
| `skills/visual-workshop/visual-generation-tasks` | `visual-generation-tasks` |
| `skills/galgame-workshop/galgame-story-editing` | `galgame-story-editing` |
| `skills/galgame-workshop/galgame-project-assets` | `galgame-project-assets` |
| `skills/galgame-workshop/galgame-transcription-asr` | `galgame-transcription-asr` |
| `skills/galgame-workshop/galgame-export-handoff` | `galgame-export-handoff` |
| `skills/video-editor/video-timeline-editing` | `video-timeline-editing` |
| `skills/video-editor/video-media-assets` | `video-media-assets` |
| `skills/video-editor/video-render-export` | `video-render-export` |
| `skills/director-desk/director-project-library` | `director-project-library` |
| `skills/director-desk/director-scene-tools` | `director-scene-tools` |
| `skills/audio-annotation/audio-annotation-project-and-document` | `audio-annotation-project-and-document` |
| `skills/audio-annotation/audio-annotation-segment-transcription` | `audio-annotation-segment-transcription` |
| `skills/cross-cutting/files-library` | `files-library` |
| `skills/cross-cutting/model-inference` | `model-inference` |
| `skills/cross-cutting/call-logs-readonly` | `call-logs-readonly` |
| `skills/cross-cutting/integrations-admin` | `integrations-admin` |

## 写作约定

- `name` 必须等于含 `SKILL.md` 的目录名（Agent Skills / Cursor 规范）。
- 每个离散 skill 含「前置（单独安装时必做）」与「最小可运行示例」。
- 不设 `disable-model-invocation`，便于按任务自动命中。
