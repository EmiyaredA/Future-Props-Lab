# Agent Note: Amadeus 跨工坊工作区与 Happier 渲染

Status: implemented

## Problem

云控曾同时提供远程画面与嵌入的整机编程工作台。Studio 各工坊需要一个共享的项目助手，可把多个有权访问的项目放入同一轮，并用适合编程任务的会话格式展示结果。

## Decision

Portal 提供独立 `/amadeus`，工坊侧栏复用会话组件。文件页等 Studio 入口沿用共用顶栏。Amadeus 通过已登记的业务操作发现项目，运行快照记录所选项目，业务所有者校验账号和版本。Happier 的连续工具分组和滚动跟随规则用于展示现有会话记录。旧云控工作台链接进入 Amadeus。

此决定更新了[Happier 加密工作台](../simplification/2026-11-07-happier-encrypted-workbench.md)的产品入口。独立 Happier 的身份与卷属于独立部署，原内嵌记录通过原部署恢复。

## Alternatives considered

继续嵌入 Happier 能保留整机编程界面，也会在 Studio 内维护两套会话和授权。直接导入其 React Native 界面会把上游路由和同步状态带入现有 Web 应用。

## Consequences

当前 FPL 账号决定项目读取范围。写入仍走工具审批、业务版本校验与回执。Agent Runtime 使用隔离连接发现模型，默认值和模型目录状态分别展示。

## Verification

Playwright 覆盖独立页面、文件入口、工坊侧栏恢复、跨工坊项目选择、Skill/MCP 范围及云控回归。独立服务测试覆盖账号隔离、特效编辑审批、版本冲突和重复执行。真实公网 Happier 的登录与恢复按发布验收流程核验。
