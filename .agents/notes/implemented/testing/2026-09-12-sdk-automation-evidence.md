# Agent Note: SDK 验收区分方法覆盖与业务闭环

Status: implemented

## Problem

生成 SDK 有具名方法并不代表工坊和模型任务的完整链路可用。

## Decision

SDK 验收分为生成方法覆盖、契约一致性和业务流程证据三层；`operations.json` 与 `coverage.json` 不替代业务闭环测试。

## Alternatives considered

- **只检查生成代码能导入** — 无法验证业务状态。
- **只写端到端 SDK 场景** — 反馈慢且难定位契约还是业务失败。

## Consequences

- **收益**：方法缺失、契约漂移和流程缺口可分别定位。
- **代价与上限**：新 API 需同步生成物、方法、文档证据和闭环测试。

## Verification

运行 `npm run contracts:check`、`npm run sdk:check` 和 `npm run test:sdk`。

