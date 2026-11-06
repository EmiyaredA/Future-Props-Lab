# Agent Note: 编程智能体教程中的外部客户端配置

Status: implemented

## Problem

外部接入独立占据面板底部，两种格式同时显示，用户需要自行匹配客户端与配置。

## Decision

Codex 和 Claude Code 的教程各包含一个可选 MCP 步骤。展开后提供对应的 profile、连接命令和配置复制。主面板填充工作区可用高度，教程超出时沿用页面滚动。

此决定更新[编程智能体接入向导](../feature/2026-11-05-code-agent-connection-guide.md)中的外部接入位置。

## Alternatives considered

- 保留共享折叠区域会让用户仍需跨教程核对客户端与 profile。

## Consequences

用户可在同一份教程完成对应客户端的设置。API 密钥仍由账号设置管理。

## Verification

- 组件测试核对两份教程中的命令、折叠和配置复制。
- 浏览器测试检查主面板高度、键盘展开和窄屏访问。
