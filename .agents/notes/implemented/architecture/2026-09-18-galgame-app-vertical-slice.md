# Agent Note: galgame_workshop 垂直切片

Status: implemented

## Problem

阶段 2 媒体工坊已迁入 `apps/`，但 `galgame_workshop` 仍散落顶层（domain ~9k + schemas ~4k + routes ~1k）；`workshop_operations` 仅剩 galgame story operations；console/capabilities 仍直引 Galgame ORM，迁入后会形成反向依赖。根目录平铺会超过 6000 行目录预算。

## Decision

本批把 `galgame_workshop`（含 models、schemas、routes 与 story operations）整包迁入 `backend/app/apps/galgame_workshop/`，并按语义拆为 `story/`、`assets/`、`video/` 子域以满足目录预算。`workshop_operations` 收回 App routes 后删除。`VisualAsset*` 仍留 `models/files`。字体路径改为复用 `capabilities/media_rendering.text_layer.FONT_ROOT`，避免相对 `Path(__file__).parents` 在子域下漂移。console/capabilities 经 `orm.py` 登记表消费 mapped 类（扩展 `DESKTOP_UI_ROOTS`、`CERTIFIABLE_PROJECT_ROOTS`、`PUBLIC_WORKSPACE_PROJECT_MODELS`、`PUBLIC_WORKSPACE_GALGAME_MODELS`、`RUNTIME_QUOTA_TASK_MODELS`、`LAYOUT_PROJECT_MODELS`）；`galgame_project_asset_references` 删除保护与 llm catalog 活跃任务检查改 metadata 查询。硬切断旧路径，不留 shim。Handoff 仍仅 `video_handoff*.py` 可依赖 `apps.video_editor`。

## Alternatives considered

- **与 llm 同批迁移** — llm 是跨 App 共享运行时，不是单一产品 App；耦合 console/capabilities 更深，应后置。
- **根目录平铺迁入 apps** — 直接持有约 9k 行，击穿目录预算门禁。
- **capabilities/console 继续 import apps.models** — 破坏共享层不得依赖产品 App。

## Consequences

- **收益**：阶段 2 产品 App 全部可整体删除/替换；`workshop_operations` 消失。
- **代价与已知上限**：`llm/` 已按垂直收拢迁入自身 models/schemas/routes（见 `2026-09-18-llm-vertical-slice.md`）；`integrations/`、`demo_runtime/`、`tool_navigation/` 仍暂留顶层。

## Verification

运行 `uv run pytest -q tests/test_architecture.py tests/test_galgame*.py tests/test_media_workshop_upgrade.py tests/test_project_snapshots.py tests/test_project_storage_layout.py`；`npm run contracts:check` 与 `npm run sdk:check` 零 diff；`npm run verify-notes` 通过。
