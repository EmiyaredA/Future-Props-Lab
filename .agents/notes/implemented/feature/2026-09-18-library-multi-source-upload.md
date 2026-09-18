# Agent Note: 总文件多源上传与上传前改名

Status: implemented

## Problem

总文件 Tab 只能本机直传到公共库，无法从本项目/跨项目把已有素材收进 Workspace 公共库；上传过程也没有改显示名的步骤，用户只能上传后再重命名。

## Decision

总文件添加流程统一为「选取 → 确认改名 → 写入公共库」：

- 本机：`POST /v1/files` 增加可选 Form `display_name`（扩展名仍按实际上传文件名）。
- 项目来源：新增 `POST /v1/file-library/asset-imports`，把视觉项目素材复制为公共库独立副本，支持 `folder_id` 与按 `asset_id` 的 `display_names`。
- UI：仅 `importSource="library"` 露出「上传本地文件 / 从本项目选取 / 从跨项目选取」；确认弹层改名后再提交。跨项目列表由父组件注入，不嵌生成侧 `ProjectMediaSourceDialog`。

与 [总文件 Tab 可管理公共库](2026-09-18-library-tab-manage.md) 互链：管理入口之上补多源写入与改名。

## Alternatives considered

- **客户端 download 再 upload** — 双倍 I/O，且绕过正式复制语义；改为服务端复制 API。
- **复用 `asset-imports` 反向塞进项目再引用** — 目标是公共库本体，不是本项目引用。
- **把生成侧 picker 嵌进素材库** — 限额与 media-kind 模型不同；自建轻量选取弹层。

## Consequences

- **收益**：总文件可从三处来源收纳素材，并在落库前改名。
- **代价**：侧栏「+」菜单项增多；跨项目选取需额外加载项目列表。

## Verification

- `tests/test_visual_workshop.py`：`display_name` 上传与 `file-library/asset-imports` 复制改名。
- `web/tests/file-management.test.tsx`：总文件菜单与本地上传确认改名。
- `npm run contracts:generate`、`npm run verify-notes`。
