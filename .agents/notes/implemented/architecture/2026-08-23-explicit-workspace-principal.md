# Agent Note: Workspace 租户只来自已认证 Principal

Status: implemented

## Problem

客户端提交的 `workspace_id` 或环境式默认值可能造成跨空间读取和写入。

## Decision

业务请求通过 `StudioPrincipal` 和 `WorkspaceDep` 获取租户；业务 API 不接受客户端提交的 Workspace 身份，不使用 ContextVar 或 `default` 回退；后台任务从持久任务记录恢复 Workspace。

## Alternatives considered

- **信任请求体中的 workspace_id** — 调用简单，但把租户边界交给客户端。
- **使用 ContextVar 保存当前 Workspace** — 减少参数传递，但后台任务和并行请求容易依赖隐式上下文。

## Consequences

- **收益**：租户来源单一、可审计。
- **代价与上限**：跨空间管理必须走账号治理提供的显式授权路径。

## Verification

入口位于 `backend/app/capabilities/identity/principal.py`、`backend/app/deps.py` 和 `WorkspaceDep`；运行 Workspace、账号和后台任务隔离测试。

