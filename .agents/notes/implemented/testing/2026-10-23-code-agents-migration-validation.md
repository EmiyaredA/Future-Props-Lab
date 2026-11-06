# Agent Note: Code agent 迁移验证

Status: implemented

## Problem

正式桌面数据库停在 `0108_node_acceptance` 时，源码新增的 `0109_code_agents`
使开发启动器按预期阻止启动。历史版本断言尚未登记新版本，也缺少旧 Pi 数据升级保留的专门验证。

## Decision

历史版本清单包含 `0109_code_agents`。独立迁移测试在临时数据库构造旧会话、运行和消息，
通过正式 migration runner 升级，检查原字段、迁移历史及关联不变，新字段使用兼容默认值，
重复应用没有变更，数据库完整性和外键有效。

## Alternatives considered

- 绕过桌面预检或修改已执行 checksum：破坏正式数据保护，拒绝。
- 只验证全新数据库：不能证明旧会话与运行记录的兼容性。

## Consequences

不改变已登记迁移 SQL 或开发启动策略。正式数据仍需停机持锁、完整备份并通过正式迁移入口升级；
仓库默认 `db:migrate` 目标与桌面数据不同，执行桌面迁移时必须明确目标数据库和配置文件。

## Verification

- `uv run pytest tests/apps/agent_runtime/test_code_agents_migration.py tests/runtime/test_sqlite_migration_history.py tests/test_desktop_development.py -q`：11 passed。
- `uv run ruff check tests/apps/agent_runtime/test_code_agents_migration.py tests/runtime/test_sqlite_migration_history.py`：通过。
