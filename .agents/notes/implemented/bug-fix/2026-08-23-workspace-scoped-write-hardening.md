# Agent Note: Workspace 写入必须显式携带租户边界

Status: implemented

## Problem

早期文件和项目写入路径存在漏传 Workspace 或从资源 ID 推断租户的风险。

## Decision

根资源直接保存 Workspace，子资源继承已校验归属；`AssetStorage` 的项目路径和写入方法显式接收 `workspace_id`，后台任务从任务记录恢复租户。

## Alternatives considered

- **依赖路径或默认 Workspace 推断** — 无法证明跨空间写入不会发生。
- **每个调用点自行补过滤条件** — 新入口容易遗漏。

## Consequences

- **收益**：读写、后台任务和落盘共享同一租户边界。
- **代价与上限**：调用签名更显式，历史公共目录只能通过兼容逻辑读取。

## Verification

运行 `tests/test_tenant_context.py`、跨 Workspace 文件/日志和项目存储测试。

