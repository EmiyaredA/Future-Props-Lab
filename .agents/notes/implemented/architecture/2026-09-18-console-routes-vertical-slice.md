# Agent Note: console routes + schemas 垂直收拢

Status: implemented

## Problem

业务包与 llm 已自持契约后，账号/Workspace/平台治理/桌面 Agent/文件库 HTTP 与专属 Pydantic 仍散落在顶层 `routes/`、`schemas/`；且 `_browser_auth` / `_platform_auth` 等 helper 被 `demo_runtime`、`llm/model_templates` 跨路由引用，阻碍硬切断。

## Decision

本批将 8 个 console 协议模块迁入 `console/routes/`，5 个专属 schemas 迁入 `console/schemas/`。被外部引用的鉴权与投影 helper 抽到 `console/routes/auth.py`；`demo_runtime` 与 `llm` 改为依赖该模块。顶层 `routes/` 仅保留 `image_crop` / `video_frames`。账号等 ORM 与 `VisualAsset*` 仍暂留顶层 `models/`，Web features 不做。

## Alternatives considered

- **连同 console ORM 一并迁入** — llm/apps 多处直引 `models.accounts` / `platform_governance`；与 files 归属决策耦合，应另批。
- **image_crop/video_frames 一并进 capabilities** — 属 capabilities 协议残留，不混入 console 批次。

## Consequences

- **收益**：console 协议自持；跨路由 auth helper 有单一入口；顶层 routes 缩至 capabilities 残留。
- **代价与已知上限**：console ORM 与 `models/files` VisualAsset* 仍在顶层；共享 `schemas/files` 等未迁。

## Verification

运行 `uv run pytest -q tests/test_architecture.py` 及账号/治理/桌面/库相关测试；`npm run contracts:check`、`npm run sdk:check`、`npm run verify-notes` 通过。
