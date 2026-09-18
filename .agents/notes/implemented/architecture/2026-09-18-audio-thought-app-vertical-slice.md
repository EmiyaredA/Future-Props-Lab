# Agent Note: audio_annotation 与 thought_workshop 垂直切片

Status: implemented

## Problem

阶段 2 已用 `presentation_workshop` 验证 `apps/` 垂直切片套路，但 `audio_annotation` 与 `thought_workshop` 仍散落在顶层包、`models/`、`schemas/`、`routes/`；`capabilities/asset_store` 与 `console/governance/desktop_ui` 仍直接 import 业务 ORM，迁入 `apps/` 后会形成共享层→产品 App 的反向依赖。

## Decision

本批把 `audio_annotation` 与 `thought_workshop`（含全部 `thought_*` schemas 与 `thought_conversion` 路由）整包迁入 `backend/app/apps/`，operations 端点收回各自 App routes；装配仍走 `api.py` / `orm.py`。反向依赖统一走 metadata 表查询与 `DESKTOP_UI_ROOTS`：`assets.py` 查 `audio_annotation_projects`，`document_references.py` 查 `thought_*` 表；`annotation` / `note` / `knowledge` 根模型在 `orm.py` 登记。硬切断旧路径，不留 shim；OpenAPI/ORM 表名/迁移零行为变化。

## Alternatives considered

- **capabilities/console 继续 import apps.models** — 实现简单，但破坏「共享层不得依赖产品 App」的依赖方向。
- **本批顺带迁 video/visual/galgame** — 能更快到终态，但大体量未按已验证套路分批收拢时回滚成本高。

## Consequences

- **收益**：录音标注与思绪工坊成为可整体删除/替换的后端 App；presentation 验证过的反向依赖解法扩展到删除保护与桌面 UI 根登记。
- **代价与已知上限**：`video_editor` / `visual_workshop` / `galgame_workshop` 与 `llm/` 仍暂留顶层；`workshop_operations` 仍托管 visual/galgame operations，待对应 App 迁入后再收回。导入备份时需在创建知识库前先 `flush` 暂存素材行，避免封面 FK 依赖排序失效。

## Verification

运行 `uv run pytest -q tests/test_architecture.py tests/test_audio_annotation.py tests/test_thought_*.py`；`npm run lint`、`npm run contracts:check`、`npm run sdk:check` 零 diff。
