# Agent Note: Agent Harness 将读取、写入和外部生成分成审批边界

Status: implemented

## Problem

视觉工坊 Agent 需要读取画布和素材，但写入或外部生成会改变数据或产生费用。

## Decision

通用 Agent Harness 保持供应商无关，读取操作可直接执行；画布写入和外部生成必须经过内存审批。工具步骤写入对话消息，运行和审批等待不持久化，重启安全取消遗留状态。

## Alternatives considered

- **所有工具都要求用户审批** — 安全直观，但会阻塞无副作用读取。
- **所有工具自动执行** — 交互顺畅，但无法保护写入和付费操作。

## Consequences

- **收益**：读取与改变状态的动作边界清晰。
- **代价与上限**：写工具必须提供审批载荷和 CAS。

## Verification

运行 Agent Harness、视觉助手审批和重启取消测试。

