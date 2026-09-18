# Agent Note: llm 垂直收拢

Status: implemented

## Problem

阶段 2 产品 App 已全部进 `apps/`，但模型目录、测试台、推理与调用日志的 ORM/契约/HTTP 仍散落在顶层 `models/`、`schemas/`、`routes/`；`capabilities/transcription` 直引 `ModelEntry`/`ModelProvider`，迁入 `llm/` 后会形成 capabilities→llm 反向依赖。

## Decision

本批把 llm 归属的 `models/model_*`（含 call_log、inference）、`schemas/model_*`（含 call_log、generation_tasks、realtime_voice）与 `routes/models/*`（含 model_inference/templates/capacity）整包迁入 `backend/app/llm/{models,schemas,routes}/`。llm 保持跨 App 共享运行时，不迁入 `apps/`、不拆进 `capabilities/`。`model_templates` 同步 ORM、files、账号与 platform_governance 仍留顶层 `models/`。capabilities 经 `orm.CATALOG_MODELS` 取目录类型；runtime quota 的 inference/model/transcription 登记进 `RUNTIME_QUOTA_TASK_MODELS`。包依赖环检测对包内 `routes/` 适配层与旧顶层 `routes/` 同等豁免。硬切断旧路径，不留 shim。

## Alternatives considered

- **迁入 apps/llm** — llm 被多 App 与 console 共用，不是可独立删除的产品切片。
- **拆进 capabilities** — 会把供应商适配与测试台塞进共享能力层，边界过宽。
- **capabilities 继续 import app.llm.models** — 破坏 capabilities 不得依赖业务包。

## Consequences

- **收益**：llm 可整体审视/替换横向契约；顶层 models/routes/schemas 继续缩小。
- **代价与已知上限**：`integrations`、`demo_runtime`、`tool_navigation` 已按同套路收拢（见 `2026-09-18-integrations-toolnav-demo-vertical-slice.md`）；console 顶层 routes 仍暂留；Web features 重排未做。

## Verification

运行 `uv run pytest -q tests/test_architecture.py tests/test_model*.py tests/test_*inference*.py tests/test_*catalog*.py tests/test_*call_log*.py tests/test_visual_generation*.py tests/test_galgame_asset_management.py`；`npm run contracts:check` 与 `npm run sdk:check` 零 diff；`npm run verify-notes` 通过。
