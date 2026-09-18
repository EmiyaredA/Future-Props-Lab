# Agent Note: capabilities 媒体协议垂直收拢

Status: implemented

## Problem

阶段 5 后顶层 `routes/` 仅剩 `image_crop` / `video_frames`，而用例已在 `capabilities/asset_store/`；专属 schemas 也只被这两条路由引用，继续留在顶层会拖长空壳协议层。

## Decision

将两条 HTTP 适配与对应 schemas 迁入 `capabilities/asset_store/routes/` 与 `schemas/`，硬切断旧路径；顶层 `routes/` 清空业务源码。不迁 `schemas/files`、`project_snapshots`、`transcription`。

## Alternatives considered

- **并入 console/file_management** — 协议属公共文件能力，不是 Studio 治理用例。
- **顺手迁 files ORM** — VisualAsset* 触达 apps/llm/console，应另批。

## Consequences

- **收益**：顶层 routes 无业务协议；asset_store 自持媒体契约。
- **代价与已知上限**：共享 `schemas/files` 与 `VisualAsset*` 仍在顶层；console ORM 已收拢（见 `2026-09-18-console-orm-vertical-slice.md`）。

## Verification

运行架构与库相关测试；`npm run contracts:check`、`sdk:check`、`verify-notes` 通过。
