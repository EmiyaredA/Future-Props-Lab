# Agent Note: watch Skill 中文维护

Status: implemented

## Problem

应用中的 watch Skill 使用英文简介和指南，中文用户阅读与选择配置时存在语言障碍。仓库源文件与应用不可变版本需要保持可核对的来源关系。

## Decision

仓库 `.agents/skills/watch/SKILL.md` 维护完整中文译本，保留 `name: watch`、上游版本号、脚本、参数、配置标识和原有授权边界。`SOURCE.md` 区分固定上游脚本和本地中文译本。应用通过已授权的本地 Agent SDK 调用正式集成 API，追加不可变版本，并经 revision 校验切换默认版本；保留既有标签和启停状态。

固定来源的初始引入见 [watch Skill 安装记录](2026-10-01-watch-skill-installation.md)。

## Alternatives considered

- **只翻译目录简介**：正文仍为英文，无法满足完整中文版本的请求。
- **使用新的 Skill 名称**：会创建另一条目录记录，无法延续同一 Skill 的版本历史。

## Consequences

中文简介与指南和固定上游脚本一起打包，后续上游更新需核对译文。历史英文版本继续保留；上传不执行脚本或安装依赖。应用持久数据只通过正式 API 更新。

## Verification

使用 skill-creator 的 quick_validate.py 校验 frontmatter；打包时核对全部脚本与固定上游版本的 Git 内容一致，保留 MIT 许可证；上传后通过 API 回读默认版本、Markdown 和版本摘要，核对正文与 ZIP SHA256。
