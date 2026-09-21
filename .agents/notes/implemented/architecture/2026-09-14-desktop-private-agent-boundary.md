# Agent Note: 桌面 Agent 接入保持私有凭据与白名单边界

Status: implemented

## Problem

本地 CLI/SDK 需要访问桌面 App，但不能暴露私有启动 token、账号治理或系统命令。

## Decision

Electron 持有短路径 Unix Socket 和私有启动协议；配对请求只在内存中等待，Agent 操作由 `console/governance/desktop_agent_operations.json` 白名单登记，并复用 Management API Key 授权。

## Alternatives considered

- **直接开放本地 HTTP 或启动 token** — 接入简单，但容易被同机其他进程复用。
- **SDK 直接操作数据库或系统命令** — 覆盖面大，但绕过账号治理和应用边界。

## Consequences

- **收益**：接入默认关闭、操作范围明确。
- **代价与上限**：新增 Agent API 必须登记白名单并经过来源验证。

## Verification

运行桌面 Agent、配对和 SDK desktop 测试。

## Related proposals

[全局助手运行内核选型](./2026-09-20-global-assistant-runtime-selection.md) 复用本文的业务白名单和授权边界，不开放私有启动凭据。
