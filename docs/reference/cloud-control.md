# 云控

## 远程应用

兼容网站启用 `cloud_control.apps_enabled` 后，云控显示「远程应用」与「Agent 工作台」。远程应用一次连接一个 Mac 窗口。应用使用当前 Mac 用户账号的权限。

1. 在 Mac 登录会话中用 Xcode 命令行工具和 Go 1.24+ 构建辅助程序。先用隔离的站点配置验收，构建输出路径使用已忽略的本地目录。

   ```sh
   scripts/website/build_remote_apps.sh "$PWD/.local/remote-apps/FPLRemoteApps.app"
   ```

2. 在 Mac 的系统设置中为辅助程序授予「屏幕与系统音频录制」和「辅助功能」。运行辅助程序的 `status` 子命令检查 `unlocked`、`screen_capture` 与 `accessibility`。正式部署可设置 `FPL_REMOTE_APPS_SIGNING_IDENTITY`，使更新后的构建沿用签名身份。权限必须在运行网站的 Mac 用户登录会话中验证。
3. 在隔离 TOML 的 `[cloud_control]` 设置 `apps_enabled = true`，将 `apps_host` 设为构建脚本输出的绝对路径。用本机入口登录已获准的管理员，打开「远程应用」和「添加应用」。在「常用应用」选 Chrome 和文本编辑，或在「已安装应用」搜索。输入管理员密码保存，应用会出现在标签栏。
4. 点击应用标签和「连接应用」。应用有多个可见窗口时，用底部的窗口菜单切换。点击画面接管输入，用 Shift + Esc 释放。窗口关闭、最小化或尺寸变化后重新选择窗口。Mac 锁屏时在主机解锁再连接。
5. 在受信本机「云控设置」显式允许公网访问。从另一台设备打开现有 HTTPS 入口并验证 FPL 管理员密码。浏览器经同源 WebSocket 交换 WebRTC 信令，媒体和键鼠走 WebRTC。公网配置自托管 coturn 的 `apps_turn_urls`，例如 `turn:turn.example.com:3478?transport=udp` 和 `turns:turn.example.com:5349`，以及与中继匹配的 `apps_turn_secret`。为 TURN 单独配置 DNS、TLS 证书及中继端口范围。

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
