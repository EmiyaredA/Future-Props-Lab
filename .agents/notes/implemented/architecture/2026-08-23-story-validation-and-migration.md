# Agent Note: Story 校验保持纯函数并通过正式 API 迁移

Status: implemented

## Problem

Story 格式演进后，规则和迁移若混入 Pydantic 或数据库 migration 会难以复用和验证。

## Decision

Story 总校验由 `schemas/galgame_workshop/story_validation.py` 按规则层拆成纯函数；旧版本由适配器读取，运行期固化通过受鉴权的 `/v1` 迁移 API 执行批量 CAS。

## Alternatives considered

- **在 Pydantic 模型集中校验** — 入口方便，但会混入迁移和业务上下文。
- **用数据库 migration 改写运行期 Story** — 无法提供 Workspace 权限、并发 CAS 和可恢复业务错误。

## Consequences

- **收益**：校验可单测，迁移可分批恢复。
- **代价与上限**：迁移完成前必须保留旧格式读取兼容。

## Verification

规则归属 `backend/app/schemas/galgame_workshop/story_validation.py`；运行 Story 迁移和兼容测试。

