# Agent Note: OpenCode、Harness 与 Pi 的受限 CLI 调用

Status: implemented

## Problem

编程智能体只有 Codex 和 Claude Code 可以执行 Amadeus 与视觉验收。增加目录名称与品牌标识无法让其他本地 CLI 执行任务，直接继承个人 CLI 配置则会同时带入文件、Shell、插件及个人工具权限。

## Decision

统一连接目录登记 OpenCode、DeepSeek Harness 和 Pi，部署开关及可执行路径保存在既有 TOML code_agents 分组。按 Workspace、账号及用途的授权沿用治理 CAS；Amadeus 和视觉验收允许五种连接，面试准备仍只有 Codex。新连接默认关闭，不自动增加账号授权。

FPL 后端继续持有运行状态、工具校验、审批、事件、取消与恢复。OpenCode 使用 JSON 事件流、Harness 使用 ACP、Pi 使用 RPC；各协议转为既有 assistant_delta 与结构化验收结果。输入只来自已校验任务、连接覆盖和明确的任务 MCP 描述，不直接传递个人工具上下文。

每次启动使用持久 Workspace 之外的临时配置。OpenCode 仅复制模型连接项，关闭个人插件、指令及内置工具权限；Harness 只读取静态模型连接行，禁用个人补丁与原生工具，并由工具 guard 再次限制准确的任务 MCP 名称；Pi 只链接认证及模型文件，禁用个人扩展、上下文与所有默认工具，再显式加载 FPL 工具扩展。模型配置明确引用的环境凭据可单独传入，FPL 后端密钥不能作为模型凭据。进程生命周期和取消回收由共享 transport 维护。

共享 AgentLogo 在连接列表、详情、授权矩阵和视觉验收中呈现品牌标识。OpenCode 与 Pi SVG 的来源和 MIT 许可证记录在 providers 资产说明；既有品牌素材继续复用。布局及选择状态的决定见 [紧凑布局](../simplification/2026-10-28-code-agents-compact-layout.md)。

## Alternatives considered

- 只增加 UI 目录项：不能满足真实调用要求。
- 三种 CLI 统一走任意 Shell 或继承个人配置：无法保持后端任务工具授权边界，且失败及取消事件难以归一化。
- 将协议与进程创建留在 process 模块：会让对话、原生协议和通用生命周期形成循环依赖，因此独立共享 transport。

## Consequences

现有记录使用字符串和 JSON 表达连接 ID，不需要新增 schema。公共枚举与生成契约扩展到五种连接，SDK 和官方知识库说明同步维护。CLI 版本最低要求为 OpenCode 1.19.4、Harness 0.2.1、Pi 1.4.0；非 Codex 使用 CLI 默认模型，认证探测不能保证供应商额度。动态 Harness 模型脚本不继承，连接需使用静态配置。

## Verification

- 相关后端测试 84 项通过，覆盖 Amadeus 真实子进程与任务桥、视觉验收结构化结果、个人配置隔离、未登记工具拒绝、取消及进程回收、配置和 SQLite 迁移。
- 本机安装的三种 CLI 控制协议烟测通过，不发送供应商模型请求。确定性测试使用隔离数据库及 fake CLI，不使用正式数据或真实付费推理。
- Web 组件 28 项、TypeScript、生产构建与 OpenAPI/SDK stale-check 通过；浏览器验证明暗主题、390/768/1280/1600 宽度、键盘操作、登录行和页脚右缘。
- 本次涉及的 Python Ruff 检查通过。全仓检查另有视频下载模块 lint/format、跨功能内部导入及视觉工坊 CSS 体量问题，未覆盖其并行修改。文档中心保护检查会列出按公共契约生成的两篇 SDK 枚举说明，未为 Note 整理改写产品正文。
