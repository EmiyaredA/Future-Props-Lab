# Agent Note: 用 TestWithProof 留存浏览器功能验收证据

Status: implemented

## Problem

浏览器测试的退出状态不能直接回答哪些用户流程完成验收，截图与原始操作也缺少统一入口。

## Decision

`node scripts/test_with_proof.mjs` 将 `web/e2e/test-with-proof.catalog.yaml` 接入 TestWithProof。专用 Playwright 配置选取思绪、视觉与演示工坊的现有浏览器用例，保留业务步骤、截图、trace 和实际导出的文件。关键截图在对应 Playwright 业务步骤内采集，步骤预期随同归档。每次执行使用 `.local/test-with-proof/` 中的新配置、数据库和账号状态，以及专用回环端口。需要视觉或业务判断的条目单独提交人工审阅。

## Alternatives considered

- **直接运行全量浏览器回归** — 覆盖更多，但每轮耗时更长，关键流程与附件也不容易集中审阅。
- **另写一套端到端用例** — 可以完全按新工具组织，但会重复维护已经存在的核心旅程。

## Consequences

工作台复用现有测试与断言。试点覆盖的条目由目录声明，真实供应商生成另列为未执行。多人并行改动时可在固定提交的独立工作树验收，并保留实际版本指纹。

## Verification

`node scripts/test_with_proof.mjs --json doctor` 检查执行器，`node scripts/test_with_proof.mjs --json run` 执行试点。使用 `node scripts/test_with_proof.mjs serve --port 4319` 查看运行记录。
