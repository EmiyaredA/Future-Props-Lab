# Agent Note: 非机械改动使用 Agent Note 记录决策

Status: implemented

## Problem

关键取舍散落在提交、架构说明和验收记录中，后续维护者难以知道为何没有采用其他方案。

## Decision

行为、架构、跨文件契约、流程工具链、测试策略或落盘/网络/配置格式的非平凡改动使用 Agent Note；纯格式化、样式、无歧义重命名和局部机械修复免写。

## Alternatives considered

- **只依赖提交信息和代码** — 不能稳定表达被否方案和长期不变量。
- **为每个提交都写 Note** — 会制造流水账并削弱检索价值。

## Consequences

- **收益**：理由、取舍、后果和验证方式有独立载体。
- **代价与上限**：新增 Note 需要当场审计活跃笔记；决定翻转必须新建 Note。

## Verification

运行 `npm run verify-notes`；维护规则见 `docs/operations/agent-notes.md`。

