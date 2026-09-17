# Agent Note: FPL automation skill 真源在仓库根 skills/

Status: implemented

## Problem

官方自动化 skill 放在 `sdk/python/` 下会与可安装 Python SDK 混放；用 `.cursor/skills` 软链到真源又增加一套发现维护，语义不清。

## Decision

- 真源目录为 `skills/future-props-lab-automation/`（仓库根，不在 `sdk/` 下）。
- 不维护本仓 `.cursor/skills` 软链；需要时将本目录或叶子拷到 Agent skills 根。
- 叶子命名、内联前置与校验脚本契约仍见 [FPL automation skill 包可独立安装契约](../process/2026-09-17-fpl-automation-skills-packaging.md)。

## Alternatives considered

- **继续放在 `sdk/python/future-props-lab-automation/` + `.cursor/skills` 软链** — 靠近 SDK/CLI 分发叙事，但目录职责混杂、软链易断；否决。
- **以 `.cursor/skills/` 为唯一真源** — 本仓发现最直接，但绑定 Cursor；否决。

## Consequences

- **收益**：skill 资产与 Python 包树分离，路径语义清楚。
- **代价**：本仓 Cursor 不会自动发现该包，使用前需显式拷贝或配置 Agent skills 根。

## Verification

```bash
test -f skills/future-props-lab-automation/SKILL.md
python3 skills/future-props-lab-automation/scripts/validate_skills.py
test ! -e .cursor/skills/future-props-lab-automation
npm run verify-notes
```
