# Agent Note: 单进程 SQLite 与逻辑 Workspace 隔离

Status: implemented

## Problem

项目需要在本机部署中支持多个账号和相互隔离的工作空间，同时保持安装、备份和运维简单。

## Decision

Future Props Lab 使用单进程、单机 SQLite 作为唯一持久化真源，并在同一进程内通过 Workspace 身份做逻辑隔离；不引入 PostgreSQL、多实例 worker 或分布式任务系统。

## Alternatives considered

- **外置 PostgreSQL 与多实例部署** — 适合规模化服务，但会引入部署、队列和分布式协调成本，当前单机交付目标不需要这些边界。
- **每个账号独立数据库** — 能强化物理隔离，但会破坏共享 Workspace、统一迁移和单机备份模型。

## Consequences

- **收益**：安装、迁移、备份和桌面交付保持单一数据根。
- **代价与上限**：不提供多实例扩展；出现真实多实例需求时必须另立架构决策。

## Verification

数据库入口、桌面数据根和 Workspace 过滤分别位于 `backend/app/runtime/`、`desktop/` 和 `backend/app/console/governance/`；运行 `npm run db:migrate:check` 与相关隔离测试。

