# Agent Note: 引入项目级 watch 视频分析 Skill

Status: implemented

## Problem

当前 Codex 项目缺少可复用的视频画面与字幕分析工作流；用户还需要把同一 Skill 导入 Future Props Lab 的 Skills 目录。两处若各自取用浮动的上游版本，行为和来源难以核对。

## Decision

在 `.agents/skills/watch/` 保存 `bradautomates/claude-video` 的 `skills/watch/`，固定到提交 `03ceb42f7fa2c4439aca01752118044baabffb8f`，保留上游脚本与 `SKILL.md`，另附 MIT 许可证和来源记录。应用内 Skills 使用这份目录打成的安全 ZIP，经 `/v1/integrations/skills` 正式用例导入当前 Workspace。

## Alternatives considered

- **只安装到个人 Codex Skills** — 可在其他项目复用，但团队无法从仓库确认本项目使用的版本。
- **重新编写本地视频分析 Skill** — 可以更贴合现有工具，但会重复实现下载、字幕与画面抽取流程。

## Consequences

- **收益**：项目级 Codex Skill 与应用 Skills 使用同一固定来源，可复核和更新。
- **代价与已知上限**：该第三方 Skill 的视频下载和画面分析需要本地 Python、FFmpeg 与 yt-dlp；语音回退和 Gemini 引擎有独立配置与外部传输选项，实际运行时按用户选择配置。仓库仅收录 Skill，不自动安装依赖或模型。

## Verification

检查 `.agents/skills/watch/SKILL.md` 的 `name: watch`、`SOURCE.md` 固定提交、ZIP 根目录的 `SKILL.md` 与脚本清单；应用导入后通过 Skills 列表和版本接口确认记录存在。按需运行 `npm run verify-notes`。
