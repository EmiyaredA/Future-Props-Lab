# Agent Note: 架构测试与源码尺寸门禁保持空豁免基线

Status: implemented

## Problem

目录依赖、路由版本、迁移独立性和文件尺寸若只靠人工审查，会随功能增长失守。

## Decision

架构测试自动检查依赖方向、迁移边界、路由版本、目录职责和文件尺寸；`architecture_size_baseline.json` 的 production/tests 保持空对象。

## Alternatives considered

- **只在代码评审中提醒** — 无法稳定阻止违规重现。
- **为超限文件持续增加豁免** — 会把技术债变成永久许可。

## Consequences

- **收益**：约束可重复验证，文件规模不会持续放大。
- **代价与上限**：新增能力可能需要先拆分现有模块。

## Verification

运行 `npm test`，重点检查 `tests/test_architecture.py`。

