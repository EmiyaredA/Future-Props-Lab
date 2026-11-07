# 云控

## 授权与装配

- 云控是仅管理员可用的一级功能，入口为 `/cloud-control`。日常网站的 Agent 页签嵌入 Happier，旧 `/agents` 链接归入该页签。
  浏览器入口复核 `cloud-control.access`、指定管理员和登录后密码重验。部署和端到端加密设备登录见[Happier 部署](../operations/happier.md)。
  Happier 持有会话和执行，Runner 仅挂载已授权项目，Relay 原始端口只对回环和专用 Runner 开放。
  旧工作台保留迁移历史与恢复归属，正式网站入口使用当前装配。
- 桌面空闲偏好由 Remote Desktop 的显式用例和原子存储端口拥有，两种装配共用实现；
  HTTP 层不接收数据库会话，CAS 成功后才通知连接重读策略。配置探测和主机修改归 Host，
  网站组合路由与附加监听器归 `assembly/website`，不得重建旧 `cloud_control` 或 `web_access` 包。
- 云控密码解锁规则归 Identity 的 `use_cases/cloud_unlock.py`。共享存储在短事务内复核活动管理员
  会话、部署策略及登录后的密码重验时间，原子保存 Agent 解锁期限或桌面会话授权。两种装配注入
  存储、策略读取器和时钟，协议层不持有数据库 Session，未知提交不能自动重试。历史验证器记录仅供凭据迁移。
- Identity 全包禁止读取进程全局配置。网站和独立服务装配提供云控策略读取器；一次状态或内部授权响应
  使用同一快照，活动桌面连接、Happier 授权及云控解锁在各自的复核点重新读取策略。
- 远程应用名单由可信本机管理员重验密码后写入 TOML，窗口采集和输入由 Host 辅助程序执行。

## 远程应用

兼容网站启用 `cloud_control.apps_enabled` 后，云控显示「远程应用」与「Agent 工作台」。远程应用一次连接一个 Mac 窗口。应用使用当前 Mac 用户账号的权限。

独立 Remote 只装配远程桌面。远程应用的 HTTP 操作保留原有鉴权和未启用响应。独立业务启动预检会拒绝已启用远程应用或 Happier 网站接入的配置。

1. 在 Mac 登录会话中用 Xcode 命令行工具和 Go 1.24+ 构建辅助程序。先用隔离的站点配置验收，构建输出路径使用已忽略的本地目录。

   ```sh
   scripts/website/build_remote_apps.sh "$PWD/.local/remote-apps/FPLRemoteApps.app"
   ```

2. 正式部署时将签名后的应用安装到运行网站的 Mac 账号的 `~/Applications/FPLRemoteApps.app`。在访达中打开安装后的应用，在系统设置中为它授予「屏幕与系统音频录制」和「辅助功能」。运行 `~/Applications/FPLRemoteApps.app/Contents/MacOS/fpl-remote-apps status`，检查 `unlocked`、`screen_capture` 与 `accessibility`。检查与采集都以辅助应用的身份运行。可设置 `FPL_REMOTE_APPS_SIGNING_IDENTITY`，使更新后的构建沿用签名身份。权限须在运行网站的 Mac 用户登录会话中验证。
3. 在 `[cloud_control]` 设置 `apps_enabled = true`，将 `apps_host` 设为安装后的 `fpl-remote-apps` 可执行文件的绝对路径。用本机入口登录已获准的管理员，打开「远程应用」和「添加应用」。在「常用应用」选 Chrome 和文本编辑，或在「已安装应用」搜索。输入管理员密码保存，应用会出现在标签栏。
4. 点击页头的应用标签和画面中的「连接应用」。应用有多个可见窗口时，用页头的窗口菜单切换。点击画面接管输入，用 Shift + Esc 释放。窗口关闭、最小化或尺寸变化后重新选择窗口。Mac 锁屏时在主机解锁再连接。
5. 在受信本机「云控设置」显式允许公网访问。从另一台设备打开现有 HTTPS 入口并验证 FPL 管理员密码。浏览器经同源 WebSocket 交换 WebRTC 信令，媒体和键鼠走 WebRTC。公网配置自托管 coturn 的 `apps_turn_urls`，例如 `turn:turn.example.com:3478?transport=udp` 和 `turns:turn.example.com:5349`，以及与中继匹配的 `apps_turn_secret`。为 TURN 单独配置 DNS、TLS 证书及中继端口范围。

使用临时签名重新构建后，如果「辅助功能」开关已打开，但 `status` 返回
`accessibility: false`，请在系统设置中移除旧条目，再添加当前构建的 `FPLRemoteApps.app`。

coturn 使用 `use-auth-secret` 与 `static-auth-secret`。将后者设为与 FPL 相同的部署密钥，
配置 `realm`、`cert`、`pkey` 与 `min-port` / `max-port`。若中继位于 NAT 后，
配置 `external-ip` 映射。防火墙开放 STUN/TURN 的 UDP 监听端口、TURN/TLS 的 TCP
监听端口和配置的 UDP 中继端口范围。公网验收应通过 WebRTC 统计确认所选候选对实际使用了 TURN。

上线前分别记录局域网、公网直连和 TURN 中继的点击到画面变化 P95，以及限速丢包下的恢复表现。目标为局域网 150 ms 内和正常公网 300 ms 内。测试 Chrome 与文本编辑的中文输入、滚动、拖拽、快捷键和多窗口，再验证失焦、注销、移除应用与锁屏时停止输入，撤权与切换时清屏。按部署门禁通过后在正式网站启用该功能。启用时网站的 VNC 连接入口被关闭。

远程应用使用 `GET /v1/cloud-control/apps` 读取允许的应用，使用 `GET /v1/cloud-control/apps/installed` 与 `PUT /v1/cloud-control/apps` 从可信本机读取目录和保存名单。保存使用配置 revision。`POST /v1/cloud-control/apps/connect` 签发 30 秒内单次有效的浏览器会话票据，由同源 `/v1/cloud-control/apps/socket` 消费。

## 屏幕共享模式

管理员从「云控」页头切换「远程桌面」与「Agent 工作台」。当前视图占满内容区。切换时保留桌面连接和工作台会话，浏览器按账号记住上次选择。

## 本机启用

1. 在目标 Mac 开启屏幕共享并设置独立 VNC 密码。复用本地 RustDesk 工程 `deploy/mac-browser-remote` 的带认证补丁 guacd 镜像，容器端口仅映射到 `127.0.0.1:4822`。默认由容器通过 `host.docker.internal:5900` 连接同一台 Mac。
2. 从可信本机入口登录管理员账号，打开「云控设置」。输入 FPL 管理员密码，检查两项服务状态并启用云控。
3. 在「远程桌面」点击「连接桌面」，输入刚才设置的 VNC 密码。点击远程画面或其中的输入框，底部显示「键盘已接管」后即可打字。遇到 macOS 锁屏时，在远程画面里输入 Mac 用户的登录密码。用 Shift + Esc 归还键盘焦点。按需使用「适应窗口」和「全屏」。
4. 从工具条的「自动锁定」选择 15、30、60 分钟或自定义 5–120 分钟，默认 30 分钟。连续闲置后画面清空，再次输入 VNC 密码即可重连。Agent 工作台会话与草稿独立保留。

连接建立后，远程桌面显示「等待画面」，直到浏览器绘制出首帧才显示「已连接」。连接或画面等待超时后，远程桌面会显示原因和「重新连接」入口。等待期间可以取消连接。

日常网站使用 Studio HTTPS 入口。切换到「Agent 工作台」并验证管理员密码，通过 Happier 原生设备密钥创建或恢复账号。宽屏会话默认展开右侧文件面板，窄屏用 Happier 自带的导航切换。工作台解锁有效期为 15 分钟。独立 Compose 的云控提供远程桌面。

## 公网与验收

1. 先在本机实测桌面键鼠、中文输入、缩放点位和超时重连。对 FPL 的 HTTPS 入口核验同源 WebSocket 升级，再从本机「云控设置」验证管理员密码并允许公网连接。
2. 外网每次登录 FPL 后，首次连接桌面时先验证 FPL 管理员密码，再输入 VNC 密码。同一 FPL Session 内，桌面空闲重连只需输入 VNC 密码。注销或撤权会断开已连接桌面。
3. 从另一台设备实际操作 Mac 并验证断线重连。Happier 的公网入口单独按[部署与验收指南](../operations/happier.md)验收。Runner 项目范围由部署时的项目挂载决定。

部署端可以显式启用 `public_desktop_vnc_only`。此模式的 HTTPS 云控入口只提供远程桌面。

## 接口

- `GET /v1/cloud-control/status` 返回可用性、桌面授权、Agent 解锁期限、Happier 状态和账号空闲偏好。需要从 HTTPS 登录的本机管理员可取得固定的 `happier_studio_url`。
- `POST /v1/cloud-control/desktop/connect` 通过请求体接收本次 VNC 密码，设置短时一次性握手 Cookie。浏览器以 `guacamole` 子协议连接同源 `/v1/cloud-control/desktop/socket`。密码在后端内存中短暂使用。
- `PUT /v1/cloud-control/desktop/idle` 使用 revision 保存空闲时限。桌面空闲只由实际转发的键鼠事件刷新。
- `/v1/cloud-control/settings` 用于可信本机的桌面设置。写操作要求近期密码重验，配置保存通过文件 revision 检查并发。
- `POST /v1/code-agents/{agent_id}/enable` 仅向通过近期密码重验的本机管理员开放。它检测指定 CLI 的安装、版本和登录，再保存共享连接的启用项与可执行路径。
- `POST /v1/cloud-control/unlock` 接收 `purpose`，取值为 `agent` 或 `desktop`。调用前使用 `POST /v1/auth/reauth` 验证当前会话的管理员密码。Agent 授权有效期为 15 分钟，公网桌面授权在当前会话内有效。
- `POST /v1/cloud-control/happier/launch` 为已解锁的专用管理员签发一次性嵌入凭证。浏览器在 Happier 来源兑换专用 Cookie。

正式启用前在隔离环境验证迁移，并按既有流程停机备份、迁移和发布匹配构建。旧部署文件中的 VNC 密码可在本机保存设置时清理。
