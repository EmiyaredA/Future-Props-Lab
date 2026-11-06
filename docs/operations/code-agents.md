# 编程智能体接入

从“AI 能力 → 模型与智能体”进入，在页头切换到“编程智能体”，管理本机 Codex、Claude Code、OpenCode、DeepSeek Harness 和 Pi 的检测及当前 Workspace 使用授权。左侧列表同时显示各连接状态，选择后在右侧查看说明和账号授权；“重新检测”在列表底部。Amadeus 新对话由所选外部 CLI 执行；旧内置 Pi 运行时的对话只读保留，与新的 Pi CLI 连接分开。

“模型服务”保留模型目录、接入管理、本地模型与默认模型用途；“编程智能体”显示本机连接状态和按用途授权。两个视图沿用原地址 `/model-service` 与 `/code-agents`，支持直接访问与浏览器前进后退。切换视图不会自动检测、保存或提交模型任务。

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

最低版本为 Codex 0.163.0、Claude Code 2.1.259、OpenCode 1.19.4、DeepSeek Harness 0.2.1 和 Pi 1.4.0；实际版本须支持对应受限执行参数。Codex 可发现模型目录，其他连接使用“CLI 默认模型”。模型认证、额度与计费属于本机 CLI 的登录账号。OpenCode 使用 `opencode auth login`；Harness 通过 `dsh web` 登录；Pi 在交互界面使用 `/login`。检测仅验证版本及本地认证状态／凭据配置，不证明供应商额度或模型请求一定成功。

OpenCode 仅继承模型供应商配置，运行时禁用个人插件、项目配置和非任务工具；Harness 使用独立临时 ACP profile，仅导入静态模型连接行及凭据位置，并以不可放宽的工具 guard 拒绝非任务工具；Pi 使用临时 agent 目录、禁用内置工具和自动发现资源，仅显式载入 FPL 任务工具桥。CLI 认证文件仍由对应 CLI 管理，不复制到 FPL 配置或日志。Harness 的动态脚本模型配置不会被继承，应先在其模型连接行改用静态配置。

Pi 会检查默认供应商。未设置时，FPL 检查 Pi 已保存凭据或模型配置中的供应商，检测期间不会刷新 OAuth。Pi 的 FPL 连接禁止用外部命令解析凭据。OpenCode 的凭据列表为空时显示“未登录”，命令执行失败时显示“检测失败”。Harness 的安装向导显示本机凭据是否存在。

## 账号授权

1. 管理员选择当前 Workspace 中的有效账号。
2. 按 Agent 和用途授权 Amadeus、视觉验收或面试准备；面试准备仅支持 Codex。
3. 保存后，授权记录 revision 增加；其他窗口的旧 revision 返回冲突并要求重新读取。
4. 撤销后，后续任务及工具调用重新校验授权。

旧视觉验收、面试配置按原账号及用途兼容。首次编辑某个用途会接管该用途，保留其他账号原有有效授权；接管后不回退旧授权。旧 Codex 路径不一致且未指定统一路径时，连接卡片显示冲突，由管理员显式配置，不自动选择。

## Amadeus 与外部客户端

Amadeus 运行由后端持有，关闭或刷新窗口不重复提交任务。每次运行保存 Agent、模型、消息与上下文快照；切换 Agent 新建会话。任务最长 15 分钟，退出应用或进程异常后保留已保存文本并标记中断，不自动重试模型请求或写操作。

CLI 只获得已声明的 FPL 工具；项目写入、集成调用和会话文件写入先生成参数绑定审批。Plan 模式拒绝写工具。工具不暴露数据库、任意本机文件或通用 Shell。会话产物须显式导入目标工坊才成为项目素材。

要从外部运行的 Codex 或 Claude Code 访问 FPL，先在网站账号设置中创建 Management API Key，再在对应教程第 4 步展开 MCP 配置。运行 `fpl --profile codex connect --url "<FPL 网站地址>"` 并按提示输入密钥。Claude Code 使用 `claude` profile。复制页面上的 stdio MCP 配置后，用 MCP 的 `operations` 核对可用操作和资源版本。终端找不到 `fpl` 时，在命令和配置中使用其绝对路径。

MCP 提供 operations、call 和 open。call 的显式 files 参数可上传文件，小文件下载返回 Base64，大文件使用 `fpl call --output`。访问范围由账号权限、API Key scope 和业务白名单共同决定。账号设置的 API 密钥列表可撤销客户端。

连接详情可查看可执行文件路径。状态区分未启用、未安装、未登录、版本不支持、检测失败与未授权；“已连接”不代表已获准用于全部用途。授权表按账号显示 Amadeus、视觉验收和面试准备权限；面试准备仅支持 Codex。保存期间暂时禁用账号和开关，冲突后载入最新授权并要求重新核对，不自动重提。

第 4 步的 MCP 配置默认收起。展开和复制由页面完成，账号授权由网站的 API 密钥管理。
