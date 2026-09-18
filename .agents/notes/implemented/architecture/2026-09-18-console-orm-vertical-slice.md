# Agent Note: console ORM 垂直收拢

Status: implemented

## Problem

阶段 5 只迁了 console 协议层，账号/Workspace/平台治理 ORM 仍散落在顶层 `models/`，与 `VisualAsset*` 共享残留混在一起，且 llm/apps 通过 `app.models` 再导出间接依赖治理表。

## Decision

将 `accounts`、`workspace`、`platform_governance`、`model_templates`、`runtime_admission` 迁入 `console/models/`；`orm.py` 登记 mapper；顶层 `models/` 仅留 `files`、`project_operations`、`defaults`。硬切断旧模块路径。不迁 VisualAsset* / schemas/files / Web。

## Alternatives considered

- **继续经 app.models 再导出账号表** — 掩盖归属，与硬切断目标冲突。
- **与 VisualAsset* 同批** — 触达面过大，应另批。

## Consequences

- **收益**：console 自持 ORM+协议；顶层 models 缩小到真正共享形状。
- **代价与已知上限**：`VisualAsset*` 与 `schemas/files` 仍在顶层；业务包/llm 可依赖 `app.console.models`。

## Verification

运行架构、账号、Workspace、平台治理与 runtime 测试；contracts/sdk/notes 通过。
