# Agent Note: asset_store 收拢 VisualAsset 与 files 契约

Status: implemented

## Problem

阶段 7 后顶层 `models/files`（VisualAsset*）与 `schemas/files`、`project_snapshots` 仍是跨 apps/llm/console 的共享残留，而用例与媒体协议已在 `capabilities/asset_store/`，归属与消费路径不一致。

## Decision

将 `models/files.py` 迁为 `capabilities/asset_store/models.py`，将 `schemas/files.py` 与 `schemas/project_snapshots.py` 迁入 `capabilities/asset_store/schemas/`。硬切断顶层路径，不经 `app.models` 再导出 VisualAsset*。`defaults`、`project_operations`、`transcription` 与空 `routes/` 占位暂留。

## Alternatives considered

- **继续经 app.models 再导出** — 掩盖归属，与硬切断冲突。
- **与 transcription/project_operations 同批** — 归属不同包，分批更清晰。

## Consequences

- **收益**：asset_store 自持素材 ORM 与核心文件契约；顶层 models/schemas 进一步缩小。
- **代价与已知上限**：`defaults`、`project_operations*`、`transcription` 仍在顶层；apps/llm/console 依赖 `capabilities.asset_store.models`。

## Verification

运行架构与库/视觉/视频/galgame/llm asset 相关测试；`npm run contracts:check`、`sdk:check`、`verify-notes` 通过。
