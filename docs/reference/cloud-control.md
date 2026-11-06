# 云控

管理员从「云控」页头切换「远程桌面」与「Agent 工作台」。当前视图占满内容区。切换时保留桌面连接和工作台会话，浏览器按账号记住上次选择。

## 本机启用

1. 在目标 Mac 开启屏幕共享并设置独立 VNC 密码。复用本地 RustDesk 工程 `deploy/mac-browser-remote` 的带认证补丁 guacd 镜像，容器端口仅映射到 `127.0.0.1:4822`。默认由容器通过 `host.docker.internal:5900` 连接同一台 Mac。
2. 从可信本机入口登录管理员账号，打开「云控设置」。输入 FPL 管理员密码，检查两项服务状态并启用云控。
3. 在「远程桌面」点击「连接桌面」，输入刚才设置的 VNC 密码。点击远程画面或其中的输入框，底部显示「键盘已接管」后即可打字。遇到 macOS 锁屏时，在远程画面里输入 Mac 用户的登录密码。用 Shift + Esc 归还键盘焦点。按需使用「适应窗口」和「全屏」。
4. 从工具条的「自动锁定」选择 15、30、60 分钟或自定义 5–120 分钟，默认 30 分钟。连续闲置后画面清空，再次输入 VNC 密码即可重连。Agent 工作台会话与草稿独立保留。

连接建立后，远程桌面显示「等待画面」，直到浏览器绘制出首帧才显示「已连接」。连接或画面等待超时后，远程桌面会显示原因和「重新连接」入口。等待期间可以取消连接。

配置 Happier 的部署中，从同站 HTTPS 入口进入云控，切换到「Agent 工作台」并验证管理员密码。首次打开 Happier 时使用其 FPL 登录按钮，沿用当前 FPL 登录态。宽屏打开会话后，左侧是会话列表，中间是对话，右侧默认打开文件面板。窄屏通过 Happier 自带的按钮切换。已有 FPL 历史可从 `/agents` 查看。

尚未配置 Happier 的部署继续使用 FPL 工作台。选好项目和已启用的 CLI，点「验证并解锁」并输入 FPL 管理员密码。工作台解锁有效期为 15 分钟。

## 公网与验收

1. 先在本机实测桌面键鼠、中文输入、缩放点位和超时重连。对 FPL 的 HTTPS 入口核验同源 WebSocket 升级，再从本机「云控设置」验证管理员密码并允许公网连接。
2. 外网每次登录 FPL 后，首次连接桌面时先验证 FPL 管理员密码，再输入 VNC 密码。同一 FPL Session 内，桌面空闲重连只需输入 VNC 密码。注销或撤权会断开已连接桌面。
3. 从另一台设备实际操作 Mac 并验证断线重连。Happier 的公网入口单独按[部署与验收指南](../operations/happier.md)验收。已有 FPL 公网 Agent 执行沿用 TOML 项目授权。

部署端可以显式启用 `public_desktop_vnc_only`。在本机「云控设置」打开公网桌面后，此模式的 Agent 执行仅支持本机入口。

## 接口

- `GET /v1/cloud-control/status` 返回可用性、桌面授权、Agent 解锁期限和账号空闲偏好。
- `POST /v1/cloud-control/desktop/connect` 通过请求体接收本次 VNC 密码，设置短时一次性握手 Cookie。浏览器以 `guacamole` 子协议连接同源 `/v1/cloud-control/desktop/socket`。密码在后端内存中短暂使用。
- `PUT /v1/cloud-control/desktop/idle` 使用 revision 保存空闲时限。桌面空闲只由实际转发的键鼠事件刷新。
- `/v1/cloud-control/settings` 用于可信本机的桌面设置。写操作要求近期密码重验，配置保存通过文件 revision 检查并发。
- `GET /v1/agent-workbench/execution/directories` 在可信本机浏览 Mac 目录。省略 `parent` 时返回导航入口，传入后返回直接子目录。
- `POST /v1/agent-workbench/execution/projects` 接受本机目录 `root`，校验后返回稳定的账号项目 ID。推荐目录和最近项目通过本机 `GET /v1/agent-workbench/execution/catalog` 返回。
- `POST /v1/code-agents/{agent_id}/enable` 仅向通过近期密码重验的本机管理员开放。它检测指定 CLI 的安装、版本和登录，再保存共享连接的启用项与可执行路径。
- `POST /v1/cloud-control/unlock` 接收 `purpose`，取值为 `agent` 或 `desktop`。调用前使用 `POST /v1/auth/reauth` 验证当前会话的管理员密码。Agent 授权有效期为 15 分钟，公网桌面授权在当前会话内有效。
- `POST /v1/cloud-control/happier/launch` 为已解锁的专用管理员签发一次性嵌入凭证。浏览器在 Happier 来源兑换专用 Cookie。

正式启用前在隔离环境验证迁移，并按既有流程停机备份、迁移和发布匹配构建。旧部署文件中的 VNC 密码可在本机保存设置时清理。
