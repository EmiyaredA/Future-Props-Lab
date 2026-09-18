# Agent Note: 架构门禁改为目录预算与软上限

Status: implemented

## Problem

单文件硬上限（TS 800 / CSS 600）推动了 `-foundation`/`-components`/`-interactions` 机械分片和空壳 `@import` barrel，伤害可读性；空的 `architecture_size_baseline.json` 豁免机制也无法表达「真正要约束的是一层目录的体量」。

## Decision

删除尺寸豁免基线文件。单文件改为可评审软上限（Python 900、TS/TSX 1000、CSS 800、测试 1200）。真正硬约束是重构目标目录（`web/src/apps|console`、`backend/app/apps|console|capabilities`）每一层直接持有的源码不超过 6000 行；这些目录禁止机械分片后缀与空壳样式 barrel。App 之间默认零依赖，仅登记的交接用例可经公共入口跨 App。

## Alternatives considered

- **继续抬高单文件硬上限并维护豁免表** — 会把技术债变成永久许可，也阻止不了机械切片。
- **立刻全仓禁止 `-foundation` 后缀** — 现有 97 个分片仍在旧 `features/` 路径；应随垂直切片逐步清退。

## Consequences

- **收益**：门禁对齐「千层面」原则——单组件冗长可替换，目录平铺与机械分片不可接受。
- **代价与已知上限**：旧 `features/` 路径在迁入 `apps/`/`console/` 前不强制目录预算。
- **取代**：[空豁免基线尺寸门禁](../../archived/testing/2026-08-23-architecture-gates-and-empty-size-baseline.md)。

## Verification

运行 `uv run pytest -q tests/test_architecture.py`，确认尺寸、目录预算、命名与 App 交接用例通过。
