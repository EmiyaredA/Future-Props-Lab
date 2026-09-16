# Agent Note: 供应商出网与后台 Runner 采用显式安全约束

Status: implemented

## Problem

供应商 URL、重定向、DNS 解析和后台恢复同时涉及 SSRF、重复执行和资源泄漏风险。

## Decision

连接前重新解析主机并拒绝凭证型 URL、私网/链路本地/多播地址和不安全重定向；后台 Runner 由单机生命周期管理，重启时按持久状态安全恢复或取消。

## Alternatives considered

- **只校验初始 URL** — 重定向和 DNS 变化可能绕过检查。
- **任务自行无限重试** — 会放大重复调用、计费和资源泄漏。

## Consequences

- **收益**：外部请求和恢复风险集中在可审计边界。
- **代价与上限**：部分供应商网络拓扑会被拒绝，任务必须表达可恢复状态。

## Verification

运行 provider egress、runner、generation runtime 和安全测试。

