# Agent Note: 明确排除 Bot、RAG、电话、扩展和多实例部署

Status: implemented

## Problem

模型基础设施管理台容易不断吸收 Bot、知识库、电话接入和多实例部署需求，导致核心单机能力失去边界。

## Decision

当前产品明确不提供 Bot 会话、RAG、电话接入、浏览器扩展和多实例租户部署；实时语音仅保留模型测试，思绪工坊的知识库仅是文档项目容器。

## Alternatives considered

- **沿用更大平台的全部能力** — 会提前引入检索、电话和多实例运维负担。
- **完全不保留扩展点** — 会阻碍当前已存在的 SDK、Agent 和工坊边界。

## Consequences

- **收益**：部署、权限、数据和测试范围可控。
- **代价与上限**：未来扩展必须满足真实消费者或明确交付需求，并另立架构。

## Verification

检查 `AGENTS.md`、`README.md`、项目结构和 API/功能列表。

