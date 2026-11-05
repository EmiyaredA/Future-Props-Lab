# Agent Note: Tool loop and explicit approval lifecycle

Status: implemented

## Problem

通用工具循环在旧 Harness 包中默认使用模块级审批协调器，网站视觉助手也直接导入这个
单例。不同应用实例可能共享等待句柄，停机缺少集中清理，父包聚合导出掩盖实际依赖。

## Decision

无业务归属的上下文预算、工具循环和进程内审批等待机制归
`studio/runtime/tasks/reactive_tools/`。`ReactiveToolLoop` 必须接收调用方提供的审批端口，
没有默认协调器；网站和独立视觉服务分别创建本实例的协调器，关闭时取消所有等待。
已关闭的协调器拒绝新等待，拒绝/取消不会产生批准回执，批准保留提案使用的原 revision。
移除原父包重导出与无行为的 `AgentHarness` 子类，消费者直接导入具体类型和实现。

## Alternatives considered

把全局协调器移到另一个模块不能解决跨实例共享。让循环在内部创建一个新协调器则无法
让协议入口和循环可靠共享同一生命周期，因此要求显式注入。
该循环不拥有持久任务或业务审批，放入某个业务服务会引入不必要的跨应用内部依赖。

## Consequences

通用组件只负责进程内等待和执行机制。业务所有者继续复核授权、持久保存动作、推进最终
状态并处理重启；本批不把内存句柄当作审批真源，也不改写 HTTP、SSE 或存储格式。
模型消息契约仍归 Agent Runtime 的公开协议，跨应用不得借此导入具体存储或供应商实现。

## Verification

- 原 Harness、视觉助手、工具、独立流、附件、目录及架构回归：91 passed。
- 生命周期和更新后的 Studio 约束：28 passed，覆盖实例隔离、取消、过期和关闭拒绝新等待。
- 核心循环及生命周期最终复查：10 passed，真实 broker 与替代审批端口运行相同提案版本用例。
- 23 个服务在镜像源码闭包中导入入口和 CLI 帮助通过；未执行实际 Docker 构建。
- OpenAPI 与部署归属清单 stale-check 通过；未访问正式数据或真实供应商。
