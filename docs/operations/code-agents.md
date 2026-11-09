# 编程智能体接入

从「AI 能力 → 模型与智能体」进入，在页头切换到「编程智能体」，查看本机 Codex、Claude Code、OpenCode、
DeepSeek Harness 和 Pi 的连接状态。Amadeus 新对话由所选外部 CLI 执行。旧内置 Pi 运行时的对话只读保留。

「模型服务」保留模型目录、接入管理、本地模型与默认模型用途。两个视图沿用 `/model-service` 与 `/code-agents`，
支持直接访问和浏览器前进后退。检测、保存和提交模型任务由用户主动触发。

## 部署连接

在实际部署的 `backend/config.toml` 配置：

```toml
[code_agents]
codex_enabled = true
codex_executable = ""
claude_enabled = true
claude_executable = ""
opencode_enabled = true
opencode_executable = ""
dsh_enabled = true
dsh_executable = ""
pi_enabled = true
pi_executable = ""
```

空路径启用自动发现；显式路径优先。安装和登录在终端完成。本机管理员可在启用前点“重新检测”，分别核对安装版本和登录结果。状态显示“待启用”后，管理员可验证密码并启用。检测本身不启用连接或提交模型任务。默认连接关闭。

最低版本为 Codex 0.163.0、Claude Code 2.1.259、OpenCode 1.19.4、DeepSeek Harness 0.2.1 和 Pi 1.4.0；实际版本须支持对应受限执行参数。Codex、OpenCode、Pi 和 DeepSeek Harness 从受限 CLI 接口发现模型，Claude Code 提供 Happier 的模型预设。各连接均可选择「CLI 默认模型」，模型发现失败单独显示。模型认证、额度与计费属于本机 CLI 的登录账号。OpenCode 使用 `opencode auth login`；Harness 通过 `dsh web` 登录；Pi 在交互界面使用 `/login`。检测仅验证版本及本地认证状态／凭据配置，不证明供应商额度或模型请求一定成功。

OpenCode 仅继承模型供应商配置，运行时禁用个人插件、项目配置和非任务工具；Harness 使用独立临时 ACP profile，仅导入静态模型连接行及凭据位置，并以不可放宽的工具 guard 拒绝非任务工具；Pi 使用临时 agent 目录、禁用内置工具和自动发现资源，仅显式载入 FPL 任务工具桥。CLI 认证文件仍由对应 CLI 管理，不复制到 FPL 配置或日志。Harness 的动态脚本模型配置不会被继承，应先在其模型连接行改用静态配置。

Pi 会检查默认供应商。未设置时，FPL 检查 Pi 已保存凭据或模型配置中的供应商，检测期间不会刷新 OAuth。Pi 的 FPL 连接禁止用外部命令解析凭据。OpenCode 的凭据列表为空时显示“未登录”，命令执行失败时显示“检测失败”。Harness 的安装向导显示本机凭据是否存在。

## 账号授权

可信本机管理员启用部署连接。有效账号可在有权限的功能中使用已启用的连接，执行前和后续工具调用复核活动账号。
Amadeus、视觉验收和面试准备共用连接注册表，各自维护业务授权、运行和恢复边界。面试准备仅支持 Codex。
云控遵守独立的[管理员授权规则](../reference/cloud-control.md#授权与装配)。

## Amadeus 与外部客户端

顶栏 `/amadeus` 与工坊内侧栏共用 Amadeus 的账号会话。用户可从各工坊选择有权访问的项目，工坊侧栏默认带入当前项目。FPL 后端持有 Amadeus 的运行、事件、审批和恢复。每次运行保存 Agent、模型、消息与上下文快照，切换 Agent 新建会话。

为 Codex、Claude Code 或 Pi 选中支持推理强度的模型后，可为下一轮调整档位。Codex 从连接发现，Claude Code 使用 Happier 模型预设并检查已安装 CLI 的参数支持，Pi 读取模型的推理能力。OpenCode 从隔离的 `models --verbose` 目录读取模型变体，普通目录在变体探测失败时仍可用。DeepSeek Harness 通过 `GET /v1/code-agents?harness_model=<id>` 在临时 ACP 会话里先设置模型，再读取 `reasoning_effort`。Codex 快档要求模型目录宣告支持且专用 CLI 使用符合资格的登录。省略选项时使用 CLI 默认值。执行器在提交提示前复核显式选项，已失效的选择会终止该轮并提示重新选择。

变体、推理档位和快档保存在每轮快照。切换模型清除从属选项，打开历史会话时显示上一次的选择，失效的选项需重选。发送成功后，同一打开会话的下一轮回到 CLI 默认服务档位。快档资格、进程隔离和审批由执行端复核。

会话按保存的事件序号穿插回复、工具、提问及审批，流式分段与整段回复一致时去重。恢复对话时继续使用整段回复。推理摘要仅展示 CLI 明确返回的摘要，工具组和摘要可折叠。每轮展示 CLI 返回的 Token 用量和上下文占用，缺项留空，旧记录显示“用量未记录”。Token 事件中累计快照覆盖前值，步骤或消息的增量独立累计。

任务最长 15 分钟。刷新页面沿用既有任务，进程中断后保留已保存文本并标记中断。禁止自动重试未知结果的模型请求或写操作。

CLI 只获得已声明的 FPL 工具；项目写入、集成调用和会话文件写入先生成参数绑定审批。Plan 模式拒绝写工具。工具不暴露数据库、任意本机文件或通用 Shell。会话产物须显式导入目标工坊才成为项目素材。

要从外部运行的 Codex 或 Claude Code 访问 FPL，先在网站账号设置中创建 Management API Key，再在对应教程第 4 步展开 MCP 配置。运行 `fpl --profile codex connect --url "<FPL 网站地址>"` 并按提示输入密钥。Claude Code 使用 `claude` profile。复制页面上的 stdio MCP 配置后，用 MCP 的 `operations` 核对可用操作和资源版本。终端找不到 `fpl` 时，在命令和配置中使用其绝对路径。

MCP 提供 operations、call 和 open。call 的显式 files 参数可上传文件，小文件下载返回 Base64，大文件使用 `fpl call --output`。访问范围由账号权限、API Key scope 和业务白名单共同决定。账号设置的 API 密钥列表可撤销客户端。

连接详情可查看可执行文件路径。状态区分未启用、未安装、未登录、版本不支持和检测失败。执行授权由各业务入口复核。

第 4 步的 MCP 配置默认收起。展开和复制由页面完成，账号授权由网站的 API 密钥管理。

## 执行与采集边界

- Agent CLI 进程、凭据隔离、探测及 TOML 修改归 `studio/host/agent_execution/cli/`。连接 DTO 归
  `contracts/agent_runtime/`，公共连接路由归 Agent Runtime。网站由 Identity 复核活动账号，独立入口通过租约访问 Host。
  CLI 只接收任务工具授权，外部模型及认证配置按白名单读取。个人工具、执行配置、插件和工具目录保持隔离。
- Amadeus 共享记录和恢复归 `studio/apps/amadeus/storage/`，公开协议归 `contracts/amadeus/`。
  会话文件适配必须显式接收根目录；Finder 与脚本进程适配归 Host，禁止回退全局配置。
- Agent 原生会话格式、受限附件、只读文件与本机 OpenCode 读取归 `studio/host/session_collection/`；
  历史快照和活动展示协议归 `studio/contracts/agent_workbench/`。服务只能消费公开契约与采集回执，
  不加载 Host 解析器；父包不通过懒加载转发符号。
- Amadeus 使用当前页面侧栏和显式账号上下文接口，不依赖原生窗口或 IPC。下载与演示窗口使用浏览器能力，并保留弹窗阻止反馈和未保存保护。
