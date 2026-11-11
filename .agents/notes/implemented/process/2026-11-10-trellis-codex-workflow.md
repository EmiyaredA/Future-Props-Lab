# Agent Note: 主工作区的 Trellis 文档规范流程

Status: implemented

## Problem

跨模块任务涉及多个工程契约，Codex 在规划、恢复会话和审查时需要能定位到同一组条款。独立试点只能看到自己的任务，无法反映主工作区正在开展的工作。

## Decision

主工作区使用 Trellis 0.6.17 的项目技能与任务文件。Studio 后端以音频标注为首个入口，Trellis 的 [规范导航](../../../../.trellis/spec/guides/future-props-lab-contracts.md) 链接到现有工程文档。根 AGENTS.md 保留全局规则，Agent Note 记录非平凡决策。Codex App 显式调用技能，在主会话执行；Card 从主工作区目录读取任务与规范。自动 Git 提交关闭，个人日志保存在本机。

## Alternatives considered

- **仅用 AGENTS.md 与工程文档**。保留规则来源，但需要人工维护任务交接和审查上下文。
- **OpenSpec**。适合维护产品行为变更，本次主要需要按工程约束组织任务和交接。

## Consequences

- 主工作区的规划和审查可引用同一份工程契约，Card 读取同一套任务文件。
- 任务资料需要随工作推进更新。会话内实时活动属于可选集成，当前按目录接入。

## Verification

- 检查 Codex 项目技能、Studio 和 Web 的规范索引、音频标注契约和测试入口。
- 通过临时任务检查主工作区的 Card 看板和规范地图，验收后移除任务。
- 验证 Agent Note、产品文档保护及安装前后的工作区差异。
