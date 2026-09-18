# Agent Note: integrations / tool_navigation / demo_runtime 垂直收拢

Status: implemented

## Problem

llm 垂直收拢后，`integrations`、`tool_navigation`、`demo_runtime` 仍把 ORM/契约/HTTP 散落在顶层 `models/`、`schemas/`、`routes/`；与已完成的业务包自持契约模式不一致，且拉长顶层横向残留。

## Decision

本批把三包各自的 models（demo 无）、schemas、routes 迁入包内（`models.py` / `schemas.py` / `routes.py`）。`skill`/`mcp`/`tool-api` 桌面根收入 `orm.DESKTOP_UI_ROOTS`，console `desktop_ui` 只消费登记表。硬切断旧顶层路径，不留 shim。`models/files`、console 顶层 routes、Web 重排不做。

## Alternatives considered

- **只迁 integrations** — 另两包合计不足 0.5k 行，分批徒增装配噪声。
- **顺手迁 console routes** — 体量大且 `routes.accounts` 等跨路由 helper 耦合深，应单独批次。

## Consequences

- **收益**：三个 BUSINESS 包均可自持契约；顶层 models/routes/schemas 继续缩小。
- **代价与已知上限**：console 协议仍在顶层 `routes/`；`VisualAsset*` 仍留 `models/files`。

## Verification

运行 `uv run pytest -q tests/test_architecture.py tests/test_integrations*.py tests/test_tool_navigation.py tests/test_*demo*.py`；`npm run contracts:check` 与 `npm run sdk:check` 零 diff；`npm run verify-notes` 通过。
