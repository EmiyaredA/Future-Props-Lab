# Agent 工作台

Agent 工作台位于「应用 → 开发辅助」，路径为 `/apps/agent-workbench`。本批支持已有会话的阅读与持续同步，输入区明确禁用续聊；不会启动 Agent、安装 Hooks、修改个人配置或接管原端运行。

## 首次连接

1. 在已经登录的 FPL 桌面窗口中打开「来源」。
2. 选择 Codex、Claude Code、OpenCode、DeepSeek Harness 或 Pi；选择检测到的来源，或用目录选择器指定实际会话目录。
3. 确认允许当前账号保存本机阅读副本，再点击「绑定并开始同步」。看到来源状态和最后成功同步时间，表示绑定已生效。
4. 返回「会话」选择已有记录，在原 APP 或 CLI 中产生新内容。完整记录落盘后，消息会自动更新；没有逐 token 事件的来源显示「日志跟随」。

会话列表可按 Agent、APP／CLI／来源待确认、项目、归档与收藏筛选，也可搜索标题、项目路径及已索引正文。正文按最新 50 条分页。上翻后保留阅读位置，新增内容通过「有新内容」返回底部。Pi 的不同分支单独选择，不将互斥分支串成一段聊天。

## 来源与真实能力

| Agent | 读取与同步实现 | 来源识别 |
| --- | --- | --- |
| Codex | `sessions`、`archived_sessions` 下 JSONL，含 Zstandard 压缩记录；增量跟随 | `session_meta.originator` 与原生 `source`；桌面端与 CLI 共享身份时去重 |
| Claude Code | 项目目录 JSONL；Desktop Code 可以使用同一项目目录，也可指定独立来源 | `entrypoint=claude-desktop-3p` 为 APP；已识别的 CLI 标记为 CLI |
| OpenCode | SQLite 只读快照，包含 WAL 更新；可连接用户明确提供的已运行本机 HTTP 实例，以 SSE 触发补读 | 没有可靠原生来源标记时显示待确认，不凭数据库位置推断 APP 或 CLI |
| DeepSeek Harness | v4 JSONL／压缩帧，完整事件增量跟随；旧格式不自动迁移 | 缺少宿主证据时显示待确认 |
| Pi | JSONL 会话树、元信息节点、工具结果、压缩及分支摘要 | 缺少宿主证据时显示待确认，不虚构独立 Pi APP |

只读历史不要求 CLI 已登录，也不依赖 Amadeus 的 CLI 执行开关。普通 ChatGPT／Claude 云端聊天不属于工作台来源。

OpenCode 原实例填写 `http://127.0.0.1:端口` 或 IPv6 回环地址，不接受外部地址、重定向、URL 凭据及任意路径。FPL 只发读取请求，不另起服务。SSE 可用时显示「原生事件」，断开时回退为 API 校准；默认 5 秒补读校准不会自动提交提示词。

附件只允许下载已同步消息实际引用、且位于已绑定来源根内的普通文件，单文件上限 16 MiB。根外项目文件、符号链接、已失效引用与未落盘的内嵌图片不能通过此入口读取。

## 暂停、解绑与清除

- 「暂停跟随」只暂停当前阅读视图；后台仍采集，原 Agent 继续运行。恢复后补读当前记录。
- 「停用来源同步」停止该来源的新采集，并取消排队的扫描；不会停止外部 Agent。
- 「解除绑定」停止来源采集，保留 FPL 阅读副本。原生历史保持不变。
- 「清除 FPL 阅读副本」仅在关联来源均已停用后开放。重新启用来源时可再次读取。

来源不可达、格式不支持或会话文件消失时保留已有副本。格式升级在原 Agent 中完成后重新扫描；不要直接修改原生日志、数据库或 FPL 的检查点。

## 配置和数据

部署开关与采集限制放在 `backend/config.toml` 的 `[agent_workbench]`：`enabled` 默认 true、`poll_seconds` 默认 1、`files_per_pass` 默认 100。未绑定来源时不会扫描私人历史。来源绑定和阅读副本属于当前账号，管理员不能读取其他账号的会话。部署连接与 Amadeus／工坊执行授权互相独立。

追加迁移 `0117_agent_workbench` 保存来源、会话、条目、检查点、扫描回执和持久变化序号；正文使用同一 SQLite 的 FTS5 索引。原生记录是上下文真源，FPL 投影可重建。正式升级按停机备份完整运行目录及配置、迁移预检的既有流程执行，开发热加载不会代办正式迁移。

## HTTP 与事件契约

所有操作位于 `/v1/agent-workbench`，要求浏览器 Session；写操作校验 CSRF。候选发现与新来源绑定还要求经校验的桌面私有请求，Management API Key 和桌面 Agent 通道默认不能访问。

| 接口 | 行为 |
| --- | --- |
| `GET /candidates` | 返回默认位置及存在状态，不读取会话内容 |
| `GET/POST /sources` | 当前账号来源列表／显式绑定 |
| `PATCH/DELETE /sources/{id}` | revision CAS 修改／解绑；DELETE 的 `expected_revision` 为必填查询参数 |
| `POST /sources/{id}/scan`、`GET /operations/{id}` | 排队扫描及回执；重复排队复用已有任务 |
| `GET /sessions` | 游标分页，支持 q、agent_id、origin、project、archived、favorite |
| `GET /sessions/{id}`、`GET /sessions/{id}/history` | 详情与历史；历史支持 before、limit、Pi branch |
| `PATCH /sessions/{id}/preferences` | CAS 更新 FPL 收藏／别名，不修改原生标题 |
| `DELETE /sessions/{id}/copy` | CAS 清除已停用来源的阅读副本 |
| `GET /sessions/{id}/attachments/{id}` | 归属、实际引用和读取范围验证后下载 |
| `GET /events`、`GET /sessions/{id}/events` | 账号变化／单会话变化 SSE |

分页响应带 `change_cursor`；事件请求用 `after` 或 `Last-Event-ID` 续传。`event: change` 的 JSON 包含 `sequence`、`kind`、`session_id`，kind 为 source、session 或 reset。事件为已提交状态的失效通知，客户端随后重新读取投影。重放超过 200 项或游标超前时返回 reset；会话条目使用原生身份更新，重复文本不合并。Session 失效时发出 auth_expired 并关闭流。

缺少 revision 返回 422，冲突返回 409 与当前快照；跨账号 ID 按不存在处理。客户端不能指定 owner。公共接口有 OpenAPI 契约，但本批不向 SDK 的 Agent 业务操作白名单开放会话访问。

## 验证边界

隔离测试覆盖五种格式、APP／CLI 标记、增量记录、半行 UTF-8、轮转与重写、压缩帧、Pi 分支、只读 SQLite、原生 HTTP、事件续传和账号／附件隔离。浏览器旅程覆盖三栏阅读、来源授权、滚动位置、暂停恢复、明暗主题和 390／768／1280／1616 宽度。

本机只读抽样发现 Codex、Claude、OpenCode、DSH 的记录；Pi 默认目录不存在，需要用户指定实际来源后再做真机验收。测试夹具不代替五种工具在原 APP／CLI 中产生新活动的完整真机矩阵，1 GB 历史压力及同步延迟分位数也需单独实测。续聊、审批、取消和原实例控制属于后续批次。
