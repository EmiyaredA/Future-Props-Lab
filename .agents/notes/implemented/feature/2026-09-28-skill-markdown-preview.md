# Agent Note: 集成中心 Skill 原文预览

Status: implemented

## Problem

集成中心的 Skill 详情只展示导入时提取的说明和标签。用户要检查指令正文，只能下载 ZIP 并自行解压；多个不可变版本之间也无法直接比对正文。

## Decision

Skill 详情按默认版本读取并显示 SKILL.md 原文，允许切换已导入的版本。新增只读版本正文接口，先按 Workspace 校验 Skill 和版本，再从该版本目录读取根 SKILL.md。读取沿用导入时的 256 KiB 上限与 UTF-8 约束；页面将正文作为纯文本显示，保留原始 Markdown，避免把包内 HTML 或链接当作可信页面内容执行。

## Alternatives considered

- **把正文加入 Skill 列表或版本列表响应**：每次打开集成中心都会加载所有正文，增加不必要的传输。
- **由浏览器下载并解压 ZIP**：会重复实现归档解析，也无法复用服务端已有的 Workspace 和版本检查。

## Consequences

- 具有读取权限的 Workspace 成员可直接查看默认版本和历史版本的指令正文。
- 预览只显示 SKILL.md；references 等附属文件仍通过现有 ZIP 下载获取。

## Verification

- 后端 API 测试覆盖两个版本的正文、未知版本和删除后的不可访问状态。
- Web 组件测试覆盖只读用户的版本切换与键盘焦点。
- OpenAPI、Web 类型、Python SDK 和接口参考由契约生成流程同步。
