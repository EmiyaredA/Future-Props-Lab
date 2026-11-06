# Agent Note: 调用日志凭据归因与独立任务面板收窄

Status: implemented

## Problem

调用日志页同时挂着「独立模型任务」运维面板，与普通调用流水账重复；独立调用若只用调用源区分，无法看出是哪把 Management API Key 发起，也无法按密钥筛选。

## Decision

调用日志页只保留统一日志表，不再嵌入独立模型任务面板；`/v1/model-inference` 与 SDK 仍保留。新日志写入 `auth_kind` / `api_key_id` / `api_key_name` / `api_key_prefix` 快照，列表可用 `api_key_id=session` 或密钥 ID 筛选，并允许 `call_source=model_inference`。

## Alternatives considered

- **删除整个 model-inference 子系统** — 会打断 SDK、桌面 Agent 与异步落盘；本次只要去掉页面上的任务运维面。
- **只修调用源筛选、不记密钥** — 无法满足“用 key 区分”的排障需求。
- **按密钥实时 join 当前密钥表** — 密钥删除后展示会丢；快照更稳。

## Consequences

- **收益**：日志页职责单一；独立调用与网页会话都能按凭据过滤；密钥删除后仍可读历史名称/前缀。
- **代价与已知上限**：历史日志凭据为空；异步任务必须在创建时落快照；密钥页仅为样式收紧。

## Verification

- `uv run pytest tests/runtime/test_sqlite_migration_history.py tests/integration/test_call_log_credential.py -q`
- `npm run contracts:check`
- `npm run test --workspace web -- --run tests/call-logs.test.tsx`
- `npm run verify-notes`
