# Agent Note: FPL automation skill 包可独立安装契约

Status: implemented

## Problem

官方自动化 skill 放在 `sdk/python/future-props-lab-automation/` 时，若叶子目录名与 frontmatter `name` 不一致、或内容依赖「先装总包 + 仓库外 workshop_examples」，Agent 无法可靠发现 skill，也无法在只安装单个叶子时完成配对与最小调用。

## Decision

- 真源仍在 `sdk/python/future-props-lab-automation/`；叶子目录名必须等于 `name`（分类父目录仅人读组织）。
- 每个离散 skill 内联「前置（单独安装时必做）」与「最小可运行示例」，不依赖包外相对路径；完整配对/CAS 细节仍由 `fpl-connect` / `fpl-contracts` 承载。
- 本仓用 `.cursor/skills/future-props-lab-automation` 软链到真源，供 Cursor 递归发现。
- 结构由 `scripts/validate_skills.py` 校验；不设 `disable-model-invocation`，便于按任务自动命中。

## Alternatives considered

- **共享 `_shared/BOOTSTRAP.md` 由叶子相对链接** — 单装叶子时路径断裂；否决。
- **只保留总包路由、叶子不当独立 skill** — 无法满足「任意单个或几个」安装；否决。
- **把包迁到 `.cursor/skills/` 作为唯一真源** — 与 SDK 分发位置冲突；否决，改为软链发现。

## Consequences

- **收益**：单装/组合安装可用；规范合规；本仓可被 Cursor 发现。
- **代价与已知上限**：前置段落在多份 skill 中重复，契约变更需同步多文件；复杂 schema 仍依赖运行时 `fpl operations`。

## Verification

```bash
python3 sdk/python/future-props-lab-automation/scripts/validate_skills.py
test -f .cursor/skills/future-props-lab-automation/SKILL.md
npm run verify-notes
```
