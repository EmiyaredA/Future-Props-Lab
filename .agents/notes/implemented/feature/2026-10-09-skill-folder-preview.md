# Agent Note: Skill 版本目录只读预览

Status: implemented

## Problem

集成中心的 Skill 详情只能显示根目录 `SKILL.md`。导入后的版本目录里还有脚本、说明和图片，查看这些内容只能整包下载 ZIP。

## Decision

详情按已导入版本列出目录中的文件，并逐个只读打开。列表和正文都先确认 Skill、版本和 Workspace 目录，再按相对路径读取。UTF-8 文本以原文返回，单文件沿用 256 KiB 上限。png、jpeg、webp 和 gif 在文件签名匹配且不超过 8 MiB 时按图片返回。SVG 与 HTML 只作为文本。符号链接、`..` 和越出版本目录的路径拒绝读取。包内脚本仍然不会执行。原有 `skill-md` 与 ZIP 下载保留。

这扩展了 [2026-09-28 的原文预览](2026-09-28-skill-markdown-preview.md)：当时只开放根 `SKILL.md`。

## Alternatives considered

- **浏览器下载 ZIP 再解压** — 会重复做归档解析，也不能沿用服务端已有的 Workspace 和版本检查。
- **把整个目录拼成一篇正文** — 二进制和体积上限都会被撑破，也看不出文件分别在哪。

## Consequences

- **收益**：具有读取权限的成员可以在详情里切换版本并查看该版本的文件。
- **代价与已知上限**：超过文本或图片上限的文件只出现在列表中，内容仍通过 ZIP 下载。新接口不进入桌面 Agent 白名单。

## Verification

- `tests/test_integrations.py::test_skill_version_preview_lists_files_and_rejects_unsafe_paths` 覆盖嵌套文件、文本、图片、SVG、超限文件、路径穿越和符号链接。
- `web/tests/skill-tags.test.tsx` 覆盖只读用户切换版本，以及打开 `scripts/setup.py`。
