# Agent Note: Amadeus 桌面助手的可信边界

Status: implemented

## Problem

FPL 的工坊、模型和集成能力分散在不同窗口。用户需要一个可持续对话的桌面入口，既能看见当前工作状态，也能在明确确认后执行操作；独立进程中的模型凭据与 Workspace 数据不能暴露给对话脚本。

## Decision

Amadeus 是独立的 Electron 单例窗口，关闭时隐藏。窗口中的 Web Worker 使用固定于 `vendor/pi/` 的 Pi Agent Core 快照协调模型轮次与工具；模型调用由 `console/amadeus/model_bridge.py` 经 FPL 已配置的供应商适配器流式转发。Electron 仅发布可信 Studio 窗口的上下文、控件选取截图和定位消息。

八个工坊把项目、选中对象和未保存状态发布给可信窗口桥；后端写入完成后只向同账号、同 Workspace 的窗口发送刷新通知，未保存的窗口保留本地输入并展示冲突提示。会话、引用快照、审批参数摘要及执行回执按账号和 Workspace 写入 SQLite。会话文件保存在当前 Workspace 下的专属目录，文件操作拒绝目录穿越及符号链接；脚本通过独立无密钥运行器读取获批内容快照，使用 macOS 沙箱限制读写和网络。冻结运行器显式收集可用标准库模块，避免动态脚本导入在打包后失效。执行前的批准绑定参数与资源版本，未知结果不自动重试。视频时间线批处理复用原工坊的 CAS 用例；视频工坊提供公共执行入口，由 `app/api.py` 装配给 Console，避免 Console 反向依赖 App。其他 FPL 操作限于桌面 Agent 已登记清单，并通过原业务 HTTP 路由重新校验身份、Workspace 和资源版本。Tool API、MCP 和 Skill 仍由集成中心管理，Amadeus 在使用时读取其当前启用状态与版本。

## Alternatives considered

- **在 Studio 页面内嵌侧栏** — 用户切换窗口时难以持续操作，也不符合独立浮动窗口的交互要求。
- **让脚本复用后端 Python 进程** — 脚本将继承配置、数据库和供应商密钥，无法提供会话级文件边界。
- **直接从 Pi 读取开发机源码** — 构建会依赖开发机绝对路径和未固定的仓库状态。

## Consequences

- **收益**：Pi 的对话循环与 FPL 的模型、权限、数据边界各有明确归属；会话和批准记录可回看，代码可脱离原 Pi 工作树构建。
- **代价与已知上限**：第一版一次只运行一个会话任务，脚本执行依赖 macOS 沙箱。Studio 之外的系统应用不进入上下文。已执行的跨应用操作逐项结算，不提供整体回滚。
- **视觉状态**：Amadeus 头像使用固定的 7 行 × 4 帧本地图集。每一行只对应一种 Agent 状态（待命、聆听、思考、工具执行、完成、异常、暂停），窗口根据 Worker 事件切换到对应行；状态结束后回到待命，不把不同状态混在同一个动画循环中。

## Verification

`tests/test_amadeus.py` 验证会话归属、引用快照、CAS、审批摘要、一次性执行、视频时间线版本冲突、文件逃逸、模型桥接、能力调用、外部操作取消和脚本输出流；沙箱用例同时运行开发态和冻结后的运行器，并检查超时终止。`tests/test_sqlite_migration_history.py` 在临时数据库验证迁移。运行 `npm run build:amadeus-pi`、`npm run contracts:check`、`npm run verify-notes`、完整桌面后端打包和隔离桌面烟测，并检查无正式数据访问。
