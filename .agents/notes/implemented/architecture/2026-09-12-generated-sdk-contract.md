# Agent Note: Python SDK 由 OpenAPI 与 operations.json 生成

Status: implemented

## Problem

Web、后端和 Python SDK 需要共享公共 HTTP 契约，手工维护容易漂移。

## Decision

OpenAPI 是公共 HTTP 形状来源，`sdk/python/operations.json` 保存稳定方法名映射；生成 SDK、Web 类型和参考文档的脚本纳入 contracts 检查，生成文件不手工编辑。

## Alternatives considered

- **手写 SDK 方法和模型** — 可提供优雅 API，但同步成本随接口增长。
- **只暴露原始 HTTP 客户端** — 维护简单，但无法提供稳定具名方法和流程文档。

## Consequences

- **收益**：契约漂移在生成检查阶段暴露。
- **代价与上限**：具名方法覆盖不代表业务流程已验收。

## Verification

运行 `npm run contracts:check`、`npm run sdk:check` 和 `npm run test:sdk`。

