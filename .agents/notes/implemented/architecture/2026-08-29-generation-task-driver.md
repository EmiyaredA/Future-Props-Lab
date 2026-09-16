# Agent Note: 生成任务生命周期由 GenerationTaskDriver 统一编排

Status: implemented

## Problem

图片、视频和音频任务共享状态机，各功能自行重试会导致重复提交和计费。

## Decision

`llm/generation_runtime.GenerationTaskDriver` 统一负责任务状态转换、恢复和安全失败；各功能只提供任务存取、素材组装、结果落盘和调用日志钩子；`submitting` 中断不会自动重提。

## Alternatives considered

- **各工坊各自维护 Runner** — 贴近业务，但复制状态机并产生不一致语义。
- **提交失败后自动重试供应商请求** — 可能提升偶发成功率，但无法区分供应商已接受而本地未收到响应。

## Consequences

- **收益**：重复提交和重复计费风险集中控制。
- **代价与上限**：结果落盘失败只能走显式 materialization 重试。

## Verification

运行 generation task driver、provider task 和 runner 测试。

