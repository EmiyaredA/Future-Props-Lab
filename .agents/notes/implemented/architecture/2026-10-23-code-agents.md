# Agent Note: 外部 Code Agent 执行 Amadeus 与统一连接治理

Status: implemented

## Problem

Amadeus 自有 Pi 循环与已有 Codex、Claude Code 固定任务分别维护连接与生命周期；外部客户端缺少统一发现入口。

## Decision

统一 CLI 连接检测与按空间、账号、用途的治理授权。Amadeus 保留形象、上下文、审批与历史，将循环交给官方 CLI，后端持有进程与事件。受限 MCP 只桥接正式业务 API 和会话文件，短期授权不包含浏览器或桌面启动凭据。外部 MCP 复用已有本机配对与白名单。

本决定替代 [Pi 内核选型](2026-09-20-global-assistant-runtime-selection.md) 中的执行器与窗口生命周期决定。Codex 使用 App Server 的临时线程与动态工具，Claude Code 使用严格配置的流式 CLI 与短期 MCP 代理；共享检测不提交推理任务。CLI 路径与启用项仅从部署配置读取，账号授权由治理 API 持久化并按 Workspace、Agent 和用途校验。旧用途授权只在未接管时兼容，显式统一路径优先于旧路径。

运行快照包含 Agent、模型、执行路径、消息、上下文和固定 Skill 版本。后端复用已有有序事件、问题与参数绑定审批；切换 Agent 创建新会话，旧 Pi 历史只读。子进程由看门狗约束，暂停、取消和退出均等待进程与 Socket 清理，重复取消不能中断收尾。恢复仅展示已落盘结果，不自动提交任务或重放修改。

## Alternatives considered

- 保留 Pi 并额外接入 CLI：形成两套执行循环。
- 直接继承个人 CLI 工具：无法保证 FPL 数据与权限边界。

## Consequences

- Web 不再构建 Pi Worker，对话窗口关闭或刷新不终止后台任务。
- 视觉验收与面试准备共享连接注册表，保留各自受限工具及结果校验。
- 外部 stdio MCP 由独立 SDK 提供，每次调用复用配对凭据与既有操作白名单；默认只读，撤销立即影响后续调用。
- 追加迁移 0109 保存执行器和运行元数据；正式数据升级仍遵守停机快照流程。

## Verification

`tests/apps/agent_runtime/test_code_agents.py` 用两种假 CLI 和隔离数据库验证检测、流式工具、审批与提问、用途授权与 CAS、旧历史、Plan 写入拒绝、取消、过大响应和 SDK stdio。现有 Amadeus、视觉验收、面试准备与迁移回归保持业务契约。`web/e2e/code-agents.spec.ts` 覆盖入口、键盘、授权开关、主题与窄屏；真实 Electron 临时数据烟测覆盖 Plan→审批→项目修改、外部 MCP 读取/编辑与撤销。生产构建、Web 类型与 OpenAPI/SDK 生成检查通过，不进行真实付费调用。

最终定向回归中，Amadeus、验收、面试及迁移共 55 项通过，新增 Code Agent/MCP 测试 12 项通过，Web 导航与交互 49 项通过。SDK 与桌面配对回归 26 项通过，白名单清单测试发现既有清单缺少三个 Skill 文件读取接口，未据此扩大授权范围。

完整质量检查仍报告当前工作树中的独立视频下载 lint/格式问题、跨功能导入，以及既有文档中心覆盖缺口和受保护 SDK 文档 stale-check；这些路径未为本次接入改写。验证不启动正式数据或自动应用迁移。

## Risks

CLI 版本可能改变协议，连接检测拒绝不支持版本。共享 CLI 的计费身份由管理员按用途授权；CLI 登录不授予平台权限。新增迁移遵循正式桌面停机更新流程，不绕过开发兼容检查。
