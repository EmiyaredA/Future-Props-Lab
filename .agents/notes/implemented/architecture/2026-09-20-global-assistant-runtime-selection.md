# Agent Note: 全局 AI 助手运行内核选型

Status: implemented

执行器与窗口生命周期决定已由 [外部 Code Agent 执行 Amadeus 与统一连接治理](2026-10-23-code-agents.md) 替代；以下保留原始决策与当时的验证记录。

## Problem

Future Props Lab 需要一个能持续对话、读取多个工坊上下文并在审批后执行正式业务操作的桌面助手。候选内核包括 DeepSeek Harness、Pi 和 OpenCode，但产品已有 Python 后端、统一模型供应商适配、Principal/Workspace 权限、SQLite 真源和桌面单例窗口，运行内核不能引入第二套凭据、权限或业务数据真源。

## Decision

Amadeus 使用固定源码快照的 `pi-agent-core` 作为 Web Worker 内的对话循环。Pi 只负责消息循环、流式事件和工具调度；模型请求、运行记录、有序事件、审批、能力发现、执行、调用日志与恢复均由 FPL 后端拥有。当前快照来自本地 Pi 提交 `19451accdeec671c1f4da9eafac8fc270f510ef4`，构建使用仓库内 `vendor/pi/`，不依赖开发机绝对路径。

每次运行固定绑定用户、Workspace、会话、模型、上下文、引用快照和已加载能力。后端只允许同一所有者有一个活动运行，并用 `run_id` 约束模型轮次、工具审批、事件与最终回复。流式文本分批写入有序事件；停止先进入 `cancelling`，允许结算停止前的尾部文本，再进入终态。后端重启会把活动运行标为 `interrupted`，保存已落盘回复，并将进行中的外部写入标为“结果待核实”，不自动重放。

工具仍通过 FPL 正式 API 与集成目录执行。读取可以自动运行；写入、脚本、Tool API 和 MCP 调用继续绑定参数摘要与资源版本审批。Skill 固定到会话中的具体版本，附属文本文件只允许在固定目录内受限读取，加载 Skill 不授予脚本或外部调用权限。

本决定与 [Amadeus 桌面助手的可信边界](../feature/2026-09-20-amadeus-desktop-assistant.md) 共同约束实现；独立窗口置顶行为另见 [Amadeus 悬浮置顶](../feature/2026-09-21-amadeus-always-on-top.md)。

## Alternatives considered

- **DeepSeek Harness**：Cordis 插件结构适合更广泛的插件平台与多 Agent 扩展，但当时仍是 developer preview，最小 profile 也需要重新约束 shell、profile 和生命周期。当前产品范围没有获得足以抵消集成成本的收益。
- **OpenCode**：服务、SDK 和权限配置成熟，适合独立编码工作台；Amadeus 的核心是 FPL 业务对象和既有审批语义，引入独立服务会形成第二套会话与权限边界。
- **继续扩展 Python Harness**：最贴近单进程后端，也没有 Node 边界；但现有 Pi 内核已经提供所需的流式工具循环，固定快照后的维护成本可控，因此保留 Python 层作为业务治理和模型桥，而不再自建完整对话循环。

## Consequences

- FPL 对运行恢复、幂等、审批和审计负责，不能把 Pi 的内存消息状态当作业务恢复依据。
- Web Worker 崩溃或窗口刷新会结束当前运行；已保存文本可恢复，未知写入只允许查询实际状态。
- 一次只执行一个会话任务，但用户可浏览其他历史；审批和回调始终回到原运行会话。
- Studio 之外的系统应用仍不在“全局”范围内；全局指当前授权 Workspace 的 FPL 窗口和应用。
- 尚未完成 DSH、OpenCode 与 Pi 的同模型、同任务真实性能对照，不能据此宣称 Pi 在成功率、成本或延迟上领先。

## Verification

`tests/test_amadeus.py` 使用隔离数据覆盖单活动运行、事件幂等、部分回复落盘、停止尾部结算、过期审批、启动恢复、未知结果、引用快照、CAS、只读权限、文件边界、Skill 固定版本和模型调用日志。`tests/test_sqlite_migration_history.py` 在临时数据库验证新增迁移。Pi 快照通过 `npm run build:amadeus-pi` 构建；OpenAPI、Web 类型、Python SDK 与接口文档由正式生成流程同步。

完整桌面构建与真实 Electron 烟测仍受当前工作树中独立的视频剪辑器类型错误阻塞；该失败不作为 Pi 与其他候选的性能结论。
