---
name: integrations-admin
description: Manages Integration Center entries (MCP, Tool-API, Skill catalog) via integrations.*. Use when listing/creating/validating/disabling workspace integration directory entries—not for editing this repo's official fpl skill markdown.
---

# integrations-admin

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>" --write`（变更集成需要写权限）→ `fpl status`。
2. 启用前优先 validate；禁止臆造未登记方法。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

用户明确要求在工作区列出/创建/校验/停用 MCP、Tool-API 或已导入的 Skill **目录条目**。

## 不在范围

编辑本仓库官方自动化 skill 正文；工坊内容创作。

## 方法

MCP / tool-api / skills 的 CRUD 与 validate；以及 capabilities 暴露的版本/内容下载。以 `fpl operations` 列出的为准。

## 工作流

1. 确认写权限配对。
2. 启用前 validate。
3. 打开 UI：`fpl open mcp|tool-api|skill [--view list|upload|details|versions|tags]`。

## 最小可运行示例

```bash
fpl operations | grep -i integration || fpl operations
fpl open mcp
fpl open tool-api
fpl open skill
```

具体 create/validate 的 JSON 以 `fpl operations integrations.<method>` 为准。

## 失败处理

- 无写权限 → 重新 `fpl connect --write` 并在 App 中批准。
- validate 失败 → 修复条目后再启用，不要跳过校验硬开。

## 相关 skill

`fpl-connect`；本仓库 skill 维护不走本 skill。
