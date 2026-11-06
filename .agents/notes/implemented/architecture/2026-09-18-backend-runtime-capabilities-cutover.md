# Agent Note: 后端 runtime 与 capabilities 硬切断装配

Status: implemented

## Problem

功能包继续堆在 `core/`、`concurrency/`、`accounts/`、`files/` 等扁平目录里时，共享基础设施与 Studio 治理、跨 App 能力边界混在一起，后续 `apps/` 垂直切片缺少可强制的依赖方向。

## Decision

阶段 1 只做后端装配硬切断，不改 HTTP/OpenAPI/ORM/迁移行为：

- 无业务语义基础设施收到 `backend/app/runtime/`（原 `core/` + `concurrency/` + `models/base` → `orm_base.py`）。
- 有契约的共享能力收到 `backend/app/capabilities/`：`identity`、`asset_store`、`agents`、`media_rendering`、`transcription`。
- Studio 治理与库级归档收到 `backend/app/console/`：`governance`、`file_library`。
- 装配入口为 `api.py`（`/v1` router）与 `orm.py`（mapper 聚合 + 租户登记）；旧包路径全部改写，不留长期 shim。
- 依赖方向：`capabilities → runtime`；`console → capabilities/runtime`；`capabilities` 不得依赖业务包；`models` 只能依赖 `runtime.orm_base`。

## Alternatives considered

- **保留 `app.core`/`app.accounts` 转发包** — 迁移成本低，但双入口会让门禁与 import 搜索长期失效。
- **本阶段一并迁入 `apps/`** — 能一次完成垂直切片，但会把装配层与业务切片混在同一批，难验证零行为变化。

## Consequences

- **收益**：共享层与治理层可从目录判断；架构测试能禁止旧包与 capabilities→业务包依赖。
- **代价与已知上限**：业务包仍暂留原地，等阶段 2 再按 App 收口（首切片见 [presentation App vertical slice](./2026-09-18-presentation-app-vertical-slice.md)）；`runtime/operation_receipts.py` 仍引用 ORM 回执模型，环检测对 `models → runtime.orm_base` 做了显式豁免。

## Verification

运行 `uv run pytest -q tests/test_architecture.py tests/integration/test_tenant_context.py tests/apps/identity/test_account_system.py`；收口 `npm run contracts:check` 与 `npm run sdk:check` 必须零 diff。
