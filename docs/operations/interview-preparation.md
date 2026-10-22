# 面试资料准备

在「应用 → 效率协作 → 面试助手」提交岗位、JD、简历文字或原件。应用保存输入快照，把原件交给本机 Codex 的任务专属工具读取，执行真实联网搜索，再验收结构化交付。画面、语音输入和复盘评分仍为模拟，练习回答刷新后不保留。

## 启用与运行

首版支持 macOS，需要已安装并登录的 Codex CLI 0.163 或更新版本。运行 `codex login status` 检查登录；应用不自动登录，不复制认证文件内容，不修改 Codex 全局配置。模型与供应商连接只白名单读取当前配置；Shell、用户插件、额外 MCP、记忆和子代理不进入任务。

在本机 `backend/config.toml` 配置：

```toml
[interview_codex]
enabled = true
executable = "" # 自动发现；也可指定可信 CLI 的绝对路径
user_id = "绑定的 FPL 账号 ID"
```

账号 ID 通过当前账号正式接口取得，不使用用户名代替。只有绑定账号且具有当前 Workspace 内容写入权限时才能发起任务。系统默认关闭，不允许其他账号借用本机 Codex 额度。环境覆盖分别为 `FPL_INTERVIEW_CODEX_ENABLED`、`FPL_INTERVIEW_CODEX_EXECUTABLE` 和 `FPL_INTERVIEW_CODEX_USER_ID`，仅供测试与部署。

此功能新增迁移 `0106_interview_preparation`。正式桌面先按既有停机备份与正式迁移流程更新，再通过受控桌面更新入口应用后端；开发热加载不执行正式迁移。隔离验收不访问正式数据库。

## 输入与交付边界

每次提交冻结岗位、JD、补充文字、原件 ID／SHA256 和输入版本。原件限制为 10 MB，支持 TXT、Markdown、PDF、DOCX。加密、扫描、损坏或无法完整读取时提示补充文字，不做 OCR。修改文字或移除无法读取的原件后可重新准备；粘贴摘要不会被当作原件已经解析。

私有文件位于 `workspaces/<workspace-id>/interview-assistant/<room-id>/`。`materials/` 保存原件，`attempts/<task-id>/input/` 保存只读快照，`work/` 保存草稿，`delivery/` 保存最终 JSON；读取回执单独保存。工具只接受任务清单中的逻辑文件 ID 和单层草稿文件名，拒绝目录穿越、绝对路径和符号链接，不提供任意命令、环境变量或 FPL 通用 API。Codex 文件权限与 Shell 关闭配置提供第二层约束。

提交的原件和文字会被本机 Codex 当前配置的模型连接处理。网络查询只应使用岗位与技术词，不应包含候选人联系方式等私人信息。网页和材料是参考数据，其中指令不能改变任务权限。

`PreparationBundle` v1 是唯一交付真源，包含材料理解及原文定位、岗位能力、经历、知识主题、至少三条不同网络来源、六道候选问题、三题首轮顺序、评价维度和限制。来源保留 URL、检索时间、版本、支持的结论和片段。Markdown 从同一 JSON 派生。

应用检查 Schema、输入哈希、实际材料读取回执、已完成的搜索事件、原文摘录和 ID 引用。缺少来源、材料未读全或引用不自洽时保留可解析的结果供审阅，但不切换有效资料。结构验收不等同于事实核实，也不会把推测补成简历事实。

## 状态与恢复

任务为排队、运行、校验、完成、需要补充、失败、取消或中断。默认串行执行，单任务最多十五分钟。页面轮询轻量事件接口，不模拟百分比。离开不取消已提交任务，刷新从场次列表恢复。取消终止进程组；独立看护进程在父进程退出或超时时终止任务。重启后未完成记录标记中断，不自动重放调用。

创建和提交带 `request_id`；相同请求可重放回执，CAS 冲突返回 409 与当前快照。重试创建新任务／输入版本，只有当前活动任务成功才能替换有效资料。失败和取消保留原版本；练习开始时固定资料，不受后续准备影响。

## HTTP 与 SDK

接口位于 `/v1/interview-assistant`，经过现有 Session／API Key 与 Workspace 权限校验，场次和子资源还要求当前账号是创建者。跨账号／Workspace 返回不存在。Agent 白名单不自动开放新操作。

| 接口 | 用途 |
| --- | --- |
| `GET /executor` | 本机执行器、版本、绑定与登录状态 |
| `GET /rooms`、`POST /rooms` | 私有场次摘要列表／幂等创建 |
| `GET /rooms/{room_id}`、`DELETE /rooms/{room_id}` | 场次与任务版本／CAS 删除 |
| `POST /rooms/{room_id}/materials` | CAS 上传原件 |
| `GET /rooms/{room_id}/materials/{material_id}/download` | 鉴权下载原件 |
| `POST /rooms/{room_id}/preparations` | 冻结输入并幂等排队 |
| `GET /rooms/{room_id}/preparations/{task_id}/events` | 轻量状态与事件 |
| `POST /rooms/{room_id}/preparations/{task_id}/cancel` | 按任务 revision 取消 |
| `GET /rooms/{room_id}/preparations/{task_id}/bundle` | 读取结构化交付 |
| `GET /rooms/{room_id}/preparations/{task_id}/export` | Markdown／JSON 下载 |

Python SDK 资源为 `client.interview`，方法和类型由 OpenAPI 生成。创建和准备默认不自动重试；网络结果不明确时使用原 `request_id` 核对回执。上传、下载均调用正式接口，不直接操作运行数据库。

## 验证

`tests/test_interview_preparation.py` 使用临时数据库测试任务和文件边界；Web 组件与浏览器测试使用确定性资料。显式设置 `FPL_INTERVIEW_LIVE_TEST=1` 后运行 `tests/test_interview_live.py`，仅用虚构 DOCX 和临时数据库执行真实联网验收，普通 CI 不调用真实 Codex。
