# Agent Note: 平台治理与业务 Workspace 权限分层

Status: implemented

## Problem

平台角色、Workspace 角色、API Key 和敏感日志具有不同授权范围，单一管理员布尔字段无法表达边界。

## Decision

账号治理由 `accounts/` 拥有，平台策略、Workspace 角色、密钥范围和敏感数据投影分层计算；跨空间访问必须由治理用例显式授权。

## Alternatives considered

- **继续使用 is_platform_admin 全局授权** — 兼容旧客户端，但无法区分角色。
- **各业务模块自行判断平台角色** — 灵活但会复制安全规则。

## Consequences

- **收益**：权限边界可审计，兼容字段不再成为越权入口。
- **代价与上限**：新增敏感能力必须登记策略和路由权限。

## Verification

运行账号治理、权限、跨空间日志和敏感投影测试。

