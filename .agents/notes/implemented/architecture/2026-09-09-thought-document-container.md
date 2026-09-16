# Agent Note: 思绪工坊的知识库是文档项目容器

Status: implemented

## Problem

产品需要组织富文本文档、目录、历史和附件，但“知识库”不能被误解为 RAG。

## Decision

思绪工坊的知识库只表示 Workspace 权限下的文档项目容器；不引入模型检索、文件内容解析或独立权限系统。

## Alternatives considered

- **引入 RAG 知识库** — 能支持检索和问答，但会增加索引和权限投影。
- **保留旧笔记本生产模型** — 迁移成本小，但无法表达项目化目录和首页语义。

## Consequences

- **收益**：文档项目与 Workspace 权限保持一致。
- **代价与上限**：未来若引入 RAG，必须另立能力和权限设计。

## Verification

检查 `backend/app/thought_workshop/`、`web/src/features/thought-workshop/` 和思绪工坊迁移测试。

