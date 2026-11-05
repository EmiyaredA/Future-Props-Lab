# Agent Note: Amadeus 外部工具与原生脚本动作

Status: implemented

## Problem

独立 Amadeus 需要保留原批准动作的工具执行、视频批次和脚本流，同时把凭据、应用数据和宿主执行权限分别留在所属边界。

## Decision

Tool API 和 MCP 使用固定连接、版本、工具名及输入摘要的 Identity Intent，Integrations 保存一次性结果。视频时间线操作走 Video 原有 CAS 和批次回执。脚本由已认证 Mac worker 在会话目录沙箱执行，租约与输出持续检查授权。固定的 POSIX Bash 入口避免系统 sh 跳转到另一解释器时被沙箱拒绝。

## Alternatives considered

在 Amadeus 解密集成凭据会跨越配置归属。自动重派缺少应答的动作可能重复外部调用。放开沙箱进程权限解决系统 sh 跳转会扩大执行范围。

## Consequences

原脚本 NDJSON 保留输出和最终状态。已固定的 Skill 目录可读，脚本写入受沙箱拒绝。跨服务执行不持久化原浏览器断言，结果未确认时不重试。

## Verification

定向回归覆盖已批准工具输入、真实 Integrations 回执重放、Video CAS 冲突、Mac 租约、脚本输出与账户撤销。四容器隔离验收使用真实 Mac 沙箱运行固定批准脚本，并从网关 NDJSON 核对 stdout 与终态。
