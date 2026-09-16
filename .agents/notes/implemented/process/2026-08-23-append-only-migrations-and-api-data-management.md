# Agent Note: 迁移只追加，运行期数据只经正式 API

Status: implemented

## Problem

直接修改持久 SQLite 或重写旧 migration 会破坏升级路径并绕过权限和事务。

## Decision

已登记 migration 的 ID、顺序、SQL 和 checksum 不改写；schema 只能追加并登记。运行期数据创建、修复、导入和回填必须通过正式 `/v1` 用例。

## Alternatives considered

- **直接修复生产数据库** — 可能快速恢复单实例，但无法复现和审计。
- **修改旧 migration** — 新安装可能通过，却会破坏已有数据库 checksum。

## Consequences

- **收益**：迁移历史可验证，运行期写入遵守业务规则。
- **代价与上限**：修复必须设计 API 或追加 migration。

## Verification

运行 `npm run db:migrate:check` 和 SQLite migration 测试。

