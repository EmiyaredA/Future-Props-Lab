# Agent Note: 清空顶层 routes/models/schemas 横向残留

Status: implemented

## Problem

垂直切片后顶层仍留空 `routes/` 占位，以及 `models/defaults`、`project_operations` 与 `schemas/transcription|project_operations` 等共享残留，与「协议/契约归所属包」的方向不一致。

## Decision

删除空 `backend/app/routes/`。`schemas/transcription` 迁入 `capabilities/transcription/schemas.py`。`ProjectOperationReceipt` 与操作批 Pydantic 迁入 `runtime/`；ID/时间工厂统一改用已有 `runtime/ids.py`、`runtime/time.py`，删除顶层 `models/` 与 `schemas/` 包。

## Alternatives considered

- **保留顶层 models 再导出 Base** — 无消费者且掩盖归属。
- **新建 defaults 包** — 与 runtime.ids/time 重复。

## Consequences

- **收益**：顶层横向 models/schemas/routes 清零；共享原语集中在 runtime/capabilities。
- **代价与已知上限**：各 ORM 直接依赖 `runtime.ids`/`time`；路由禁令仍保留 `app.models` 防回归。

## Verification

运行架构测试与账号/音频/视觉相关回归；contracts/sdk/notes 通过。
