# Agent Note: 演示文稿 App 垂直切片首验证

Status: implemented

## Problem

阶段 1 已把共享层收到 `runtime/` 与 `capabilities/`，但业务 App 的 models、schemas、routes 仍散落横向目录，删改一个产品单元仍要跨多处；同时 capabilities/console 直接 import 业务 ORM 会在迁入 `apps/` 后形成反向依赖。

## Decision

本批只垂直切片 `presentation_workshop` 作为阶段 2 验证：整包迁入 `backend/app/apps/presentation_workshop/`（含 models/schemas/routes 与 operations 端点），装配仍走 `api.py` / `orm.py`。`capabilities/asset_store/document_references.py` 通过 `Base.metadata.tables["presentation_asset_references"]` 查询，避免 capabilities→apps；`console/governance/desktop_ui.py` 通过 `orm.DESKTOP_UI_ROOTS` 读取 presentation 根模型，避免 console→apps。硬切断旧路径，不留 shim；OpenAPI/SDK 零行为变化。

## Alternatives considered

- **一次迁完六个 App** — 能更快到终态，但 galgame 等大体量未验证套路前批量搬迁回滚成本高。
- **capabilities/console 继续 import apps.models** — 实现简单，但破坏「共享层不得依赖产品 App」的依赖方向。

## Consequences

- **收益**：首个可整体删除/替换的后端 App 形状落地；反向依赖解法可复用到后续批次。
- **代价与已知上限**：其余 App 仍暂留顶层；`models/defaults.py` 仍被 App models 引用；`DESKTOP_UI_ROOTS` 需在每迁出一个 App 时于 `orm.py` 登记。

## Verification

运行 `uv run pytest -q tests/test_architecture.py tests/test_presentation_*.py`；`npm run contracts:check` 与 `npm run sdk:check` 零 diff。
