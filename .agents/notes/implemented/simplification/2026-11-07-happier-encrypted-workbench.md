# Agent Note: Happier 加密工作台取代旧工作台

Status: implemented

## Problem

云控维护两套会话和执行入口。已有 Happier 无设备密钥方案能完成配对，但固定版本的 Codex 在首轮初始化时要求账号密钥。

## Decision

日常网站的 Agent 页签使用自托管 Happier 原生 Web、设备密钥登录和端到端加密。FPL 用原有会话和密码解锁授予浏览器访问。一次性凭证兑换检查 Relay 的强制加密策略。独立部署的云控保留远程桌面。

本决定更新了[云控 Happier 工作区](../feature/2026-11-06-happier-cloud-workspace.md)的登录和切换方式。

## Alternatives considered

保留 OIDC 无设备密钥方案需要追踪上游明文账号兼容性。保留旧工作台兜底会继续维护两套执行和授权路径。

## Consequences

管理员需要保存 Happier 恢复密钥并配对独立 Runner。旧工作台停止提供生产入口，已登记迁移及数据归属供离线恢复。正式切换前封存运行目录和配置，当前数据留在原地。

当前产品入口见[Amadeus 跨工坊工作区](../architecture/2026-11-08-amadeus-cross-workshop-workspace.md)。历史加密会话仍沿用此处的恢复边界。

## Verification

入口测试验证授权、单次兑换、加密策略检查和撤权。Web 测试验证重试、旧链接和切换视图。真实会话与上线门槛见[部署与切换](../../../../docs/operations/happier.md)。
