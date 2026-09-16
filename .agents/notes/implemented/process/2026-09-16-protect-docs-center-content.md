# Agent Note: 文档中心正文与资源不参与工程决策迁移

Status: implemented

## Problem

项目同时包含面向最终用户的文档中心和面向维护者的工程资料，混合整理可能破坏页面正文和生成契约。

## Decision

`web/src/docs/**`、`web/public/docs/**`、文档中心覆盖清单以及其生成/展示入口属于受保护产品内容。Agent Note 只读取这些内容作为事实来源，不迁移、删除、重写或重新生成。

## Alternatives considered

- **把文档中心文章整体迁入 Note** — 会破坏用户可见内容与构建入口。
- **让文档中心文章同时承担内部决策记录** — 会混淆两种受众和维护职责。

## Consequences

- **收益**：产品文档稳定，工程决策独立演进。
- **代价与上限**：事实和理由可能交叉引用，Note 不复制整篇用户文档。

## Verification

执行 `git diff -- web/src/docs web/public/docs docs/architecture/documentation-coverage.md scripts/generate_sdk_docs.py`，并运行 `npm run docs:check`。
