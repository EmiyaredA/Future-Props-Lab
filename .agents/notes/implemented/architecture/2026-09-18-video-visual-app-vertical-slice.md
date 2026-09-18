# Agent Note: video_editor 与 visual_workshop 垂直切片

Status: implemented

## Problem

阶段 2 已迁入 presentation / audio / thought，但 `video_editor` 与 `visual_workshop` 仍散落顶层；`workshop_operations` 仍托管 visual canvas operations；capabilities/console 直接 import 业务 ORM，迁入 `apps/` 后会形成反向依赖。共享渲染契约若随 schemas 进入 apps，会击穿 `capabilities/media_rendering` 与 Galgame 边界。

## Decision

本批把 `video_editor` 与 `visual_workshop`（含 assistant/generation routes 与 visual schemas）整包迁入 `backend/app/apps/`；canvas operations 收回 visual routes。`VisualAsset*` 仍留 `models/files`。时间轴文档类型（`VideoEditorClip` / `VideoEditorTimelineDocument` 等）迁到 `capabilities/media_rendering/timeline_document.py`，供渲染与 Galgame 编译共享，避免 capabilities/galgame→apps。生成任务 CreateIn 抽到 `schemas/generation_tasks.py`，供 visual 与 `llm/inference` 共用。console/capabilities 需要 mapped 类处经 `orm.py` 登记表（`DESKTOP_UI_ROOTS`、`CERTIFIABLE_PROJECT_ROOTS`、`PUBLIC_WORKSPACE_PROJECT_MODELS`、`RUNTIME_QUOTA_TASK_MODELS`、`LAYOUT_PROJECT_MODELS`）；存在性查询用 metadata。硬切断旧路径，不留 shim。

## Alternatives considered

- **一次迁完 video+visual+galgame** — 体量过大（galgame ~9k+schemas），回滚成本高。
- **timeline schema 留在 apps/video_editor** — 迫使 media_rendering/galgame 依赖 apps，破坏已有边界测试。
- **capabilities/console 继续 import apps.models** — 破坏共享层不得依赖产品 App。

## Consequences

- **收益**：媒体工坊两包可整体删除/替换；workshop_operations 仅剩 galgame。
- **代价与已知上限**：`galgame_workshop` 已按同套路迁入（见 `2026-09-18-galgame-app-vertical-slice.md`）；`llm/` 仍暂留；Galgame handoff 可 import `apps.video_editor.models`（既有交接例外）。

## Verification

运行 `uv run pytest -q tests/test_architecture.py tests/test_video_editor*.py tests/test_visual_*.py tests/test_media_workshop_upgrade.py`；`npm run contracts:check` 与 `npm run sdk:check` 零 diff。
