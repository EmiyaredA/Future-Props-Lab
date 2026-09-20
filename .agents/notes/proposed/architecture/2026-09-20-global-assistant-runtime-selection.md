# Agent Note: 全局 AI 助手运行内核选型

Status: proposed

## Problem

用户希望专门为 Future Props Lab 提供可操作全局与各应用的 AI 助手，候选为 DeepSeek Harness（DSH）、Pi 和 OpenCode。应用已经拥有 Python Agent Harness、正式业务 API、生成 SDK、桌面操作白名单及 automation skills，需要选择可接入这些能力的运行内核，避免另建租户、凭据或业务数据真源。

本文是选型建议，不代表用户已批准引入依赖、替换现有 Harness 或恢复应用内写作入口。研究截至 2026-09-20，依据本地代码和上游公开文档；未安装候选、运行供应商调用或进行三方基准测试。

## Proposal

三者中优先验证 Pi 的可嵌入内核。优先使用 pi-agent-core 的自定义工具、模型流接口、事件与运行控制；若会话分支、压缩和 skills 的复用收益明确，再评估 pi-coding-agent SDK 的受控装配。通过本项目适配层依赖固定版本，避免一开始 fork 整个产品。

Pi 当前官方仓库由 badlogic/pi-mono 跳转到 earendil-works/pi，主分支文档使用 @earendil-works 命名空间。实施时必须选定已发布版本并核验对应文档，不能混用旧 @mariozechner 示例和新接口。

工具执行继续经过 FPL 正式 API / SDK 和当前 Principal 权限。会话绑定账号与 Workspace；“全局”表示当前授权空间的跨应用编排，不自动包含账号治理、密钥管理或跨空间操作。跨应用工作流逐步调用各应用公共入口，不引入 App 内部互相导入。

模型接口继续由 llm/providers 归一化。现有 InferenceTextIn 只支持 user/assistant 文本与图片引用，没有完整工具 schema、tool-call/tool-result 消息契约；必须另行设计正式的工具调用模型桥接，不能把现有文本推理接口视作现成兼容网关，也不能导出供应商密钥给助手。

业务工具按任务和应用按需暴露。基础操作包括发现能力、读取对象、提交带 revision 的编辑、查询后台任务及打开资源。界面当前项目、选中对象、未保存状态属于显式上下文；生成任务由原有 GenerationTaskDriver 执行，Agent 仅提交、查询和展示结果。中断后查询实际状态，不自动重放未知结果的写入和付费请求。

Pi core 不自带 FPL 权限、审批、持久化或业务幂等。相关能力仍由应用所有者实现；不注册通用 shell/文件修改工具，不自动发现用户目录中的扩展。若采用上层 SDK，需要显式控制 ResourceLoader、工具集合、凭据及会话存储。关闭工具只是缩小模型能力面，不是进程沙箱。

## Runtime integration constraint

现有业务后端为 Python，Pi 为 TypeScript/Node，接入存在实际的运行宿主和协议成本。需要在实施设计中明确 Node 执行宿主、启动/退出、崩溃处理和打包；不得默认为 desktop/ 增加业务治理或第二套数据库，也不得默默改变单机单后端部署边界。若要求助手全部留在现有 Python 进程内，则优先扩展当前 capabilities/agents/harness，而不是强行嵌入这三个候选。

对话恢复与业务恢复分别验收。恢复消息、分支或日志不代表可以重放已发生的业务动作。会话持久化使用正式迁移与所属业务用例，保持 Workspace 归属；不能以运行内核的默认本地历史文件替代产品权限。

## Alternatives considered

- **DSH**：Cordis 让模型、工具、会话存储、循环与策略成为可替换插件；SDK、事件日志和多 Agent 扩展点适合插件平台。它具有 sdk-minimal，不能简单认为必须嵌入完整 Web 产品。但当前官方声明 developer preview 且会有破坏性变更；需接受 Cordis 装配、profile 与生命周期契约。最小 profile 默认开放持久 shell，且不含压缩、skills、jobs、subagents，不能直接当作受限的 FPL 助手。若第三方插件和多 Agent 协作成为核心产品目标，重新评估 DSH。
- **OpenCode**：headless HTTP 服务、OpenAPI、TypeScript SDK、会话事件、自定义工具与权限配置，适合较快连接独立 Agent 服务，也适合需要强编码能力的助手。当前 FPL 需要应用业务编排，采用它要适配已有的 coding/project/session 语义并维护第二套服务接口；权限配置不能取代 Principal 与资源归属校验。若目标变成编程工作台或接受独立 OpenCode 服务，优先级上升。
- **继续当前 Python Harness**：已有 ReactiveToolLoop、Policy、取消、事件、上下文预算和内存审批，最贴近单进程后端，也不需要 Node 桥接。长期需要自维护更完整的会话管理、运行中输入、长任务控制和可观测性。如果 Pi 的实测收益不足以抵消运行边界成本，此方案优于引入外部内核。

## Related note audit

针对活跃笔记检索 Agent Harness、全局助手、pi-agent、DeepSeek Harness、OpenCode、桌面 Agent 接入和 AI 写作下线，命中以下三篇，均为部分重叠，保留原决定并互链；没有完全吸收或过时提案需要删除或归档。

- [Agent Harness 审批边界](../../implemented/architecture/2026-08-23-agent-harness-approval-boundary.md)：现有应用内工具审批仍有效，本提案不直接替换运行实现。
- [桌面 Agent 私有边界](../../implemented/architecture/2026-09-14-desktop-private-agent-boundary.md)：外部 Agent 的配对、白名单和凭据规则仍有效；技术上的读写授权不等于逐次业务确认。
- [思绪工坊应用内 AI 写作下线](../../implemented/simplification/2026-09-20-thought-in-app-ai-writing-removed.md)：本提案复用 Agent/SDK 能力，不恢复旧入口；若新增全局应用内助手可以直接发起写作，需要另行明确产品范围变化并同步规则。

## Acceptance criteria

- 在临时数据中完成跨两个应用的读取、带 revision 修改、打开结果旅程，记录完成率、延迟、token 和适配代码成本；与现有 Python Harness 对照。
- 只读 Principal 无法写入，跨 Workspace ID 按不存在处理；切换页面或账号不改变已开始任务的授权主体。
- 409 冲突、未保存编辑、用户取消和拒绝审批均可保留输入并正确展示；停止不会被解释成业务回滚。
- 生成请求在提交后断线或进程崩溃时，不重复付费提交；重启通过任务 ID 查询并报告未知状态。
- 模型工具调用、工具结果、错误与 Usage 均能经后端归一化传输并记入对应工作区日志，真实供应商凭据不进入 Web 或助手会话。
- 原型没有通用 shell/数据库直写入口；打包和自动测试不访问正式桌面数据。固定候选版本后验证升级兼容性。

## Risks

- 最小内核并不意味着最少总开发量：权限、持久化、恢复、UI 上下文和模型桥接仍需产品实现。
- 上游当前主分支与可安装版本可能不同；此次文档研究不构成发布兼容性证明。
- 尚未对三个候选进行同模型同任务评测，不能从功能数量推出任务成功率、成本或稳定性排名。
- 如果真实目标是控制系统任意软件或跨账号治理，当前范围和推荐权重需要重新评估。

## Sources

- [Pi 官方仓库](https://github.com/earendil-works/pi)
- [Pi Agent Core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)
- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [DSH 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [DSH 最小 SDK profile](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/sdk-minimal/README.md)
- [OpenCode 服务](https://opencode.ai/docs/server/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [OpenCode 权限](https://opencode.ai/docs/permissions/)
