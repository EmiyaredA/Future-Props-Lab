# Agent Note: Visual 助手的独立模型轮次与调用日志

Status: implemented

## Problem

Visual 助手需要工具调用和逐块输出。供应商凭据、额度、提供方协议和调用日志归 Models，项目对话、工具和审批归 Visual。断线或重启可能发生在供应商接收请求之后。

## Decision

Identity 从原 SSE 请求委派同项目同对话的精确摘要。Models 为整个运行保留额度和模型签名，调用每轮前保存提交状态。标准化事件流包含文本、用量和完成事件。相同已完成轮次可重放，变化的摘要或未知结果拒绝再次调用。结算按原运行保存唯一调用日志和额度释放回执。

## Alternatives considered

把模型密钥交给 Visual 会跨越凭据归属。让 Models 执行 Visual 工具会跨越项目事务和审批边界。

## Consequences

Models 必须应用 0019 迁移。私网轮次协议已独立可运行。公开 SSE 和审批继续接入 Visual 自有执行流程。

## Verification

隔离测试核验身份委派、跨项目拒绝、增量事件顺序、重复请求、改变摘要、单一调用日志与中断后的未知回执。
