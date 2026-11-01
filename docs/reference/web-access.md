# 本地与公网访问

桌面管理员从头像菜单打开「本地与公网访问」。每次 App 启动，本地 Web 与公网均关闭。
开启本地 Web 后，浏览器访问面板显示的 `http://127.0.0.1:28081`。开启公网会先校验云端
构建标识，再开启同一监听器和受限 SSH 反向转发。关闭窗口保留运行；退出 App 停止入口和隧道。
停止访问不撤销已经提交的后台业务任务，也不会重新提交模型请求。

## 配置与恢复

连接资料属于桌面数据根的 `backend/config.toml` `[remote_web]`，只保存一个 profile。
先停止访问，再填写 HTTPS 来源、SSH 主机/端口/用户名和远端回环端口。通过原生选择器导入
不带口令的专用转发密钥和已经核验的 known_hosts。文件保存于 `backend/web-access/credentials/`，
目录 0700、文件 0600；界面只返回标识与 SSH SHA256 指纹。应用不创建或信任未知主机记录，
不保存服务器管理员凭据。应在服务器限制该密钥只能转发指定回环端口，不授予交互 Shell。

保存配置要求近期管理员密码验证和配置版本一致。所有窗口先处理未保存内容；随后停止后端、
持数据锁备份完整 runtime 与 backend、核验文件和 SQLite，再原子发布配置并重启。备份与原有
正式数据开发快照使用同一格式；配置 CAS 冲突时重新读取，不覆盖并发修改。不新增 schema 迁移。
备份耗时取决于素材体量，期间保持 App 开启，失败时查看本机日志与快照。

「接管现有 LaunchAgent 隧道」仅处理 `com.futureprops.mac-host-tunnel` 和原
`mac-reverse-tunnel.sh` 安装。应用导入专用密钥，在快照中保留 plist 与恢复命令，停用旧任务的
自动启动并卸载正在运行的旧连接；失败时不启用 App 隧道。不要同时保留两套重连管理器。

## 程序发布

`npm run build:studio` 生成 `.local/studio-release/`；`build:desktop` 使用相同 Studio 模式生成
`web/dist/`。产物附带 `build.json`、逐文件 SHA256 的 `manifest.json` 及 gzip/Brotli 旁置文件。
发布时应把同一份已核验产物供 App 和网关使用；不能用不同时间重建的文件冒充同一版本。
开发配置的 `web_root` 指向正式产物目录，禁止公开 Vite。产物不含 source map 或私人配置。

云网关配置模板及发布工具位于相邻 `remote-control` 项目：
`deploy/Caddyfile.studio`、`scripts/publish-studio.py`、`scripts/install-studio-release.py`。
服务器由管理员预先部署，发布命令需要显式指定产物、SSH 目标、管理员密钥、可信主机记录和临时目录。
App 只使用专用转发密钥，不执行远端发布命令。先发布云端资源，再更新 App 和接管旧隧道。

哈希程序资源缓存一年且不可变；HTML、构建标识和清单重新验证；普通程序文件短缓存并带 ETag。
云端保留当前和前两个版本，旧哈希请求可回退读取。`/v1`、私人素材和 SSE 只转发回 Mac，禁止共享缓存。
Mac 离线时程序与登录表单仍可读取，业务调用提示离线。云端程序可用不代表隧道或账号已就绪。

## 私有 API 与预览

- `GET /v1/desktop/web-access`：运行状态、地址、最近检测时间及本次转发量。
- `POST /v1/desktop/web-access/actions`：`local_start/local_stop/public_start/public_stop/check`，串行且幂等。
- `GET/PUT /v1/desktop/web-access/config`：脱敏配置与带版本校验的保存准备。
- `/config/adopt-legacy`、`/credentials/tickets`：近期验证后的管理员 Session 授权。
- `/credentials/import`、`/config/claim`：额外原生宿主凭据及一次性票据，页面不能直接调用。

上述接口不接受公网、Agent 通道或 Management API Key。公网关闭后新的公网请求立即拒绝。
实际 SSH 进程及带实例标识的 HTTPS `/ready` 探针共同确认连接成功，网络失败指数退避；停止立即取消重试。

`GET /v1/files/{asset_id}/thumbnail?size=320|640` 先验证当前账号归属，再生成 WebP，
缓存于该账号 `previews/`。只支持图片、限制解码像素与两个并发生成任务；不修改原始文件。
列表与画布按可见区域发起缩略图请求，视频只在主动播放时读取。浏览器首页角色动画需要主动加载。

## 验证命令

```sh
uv run pytest -q tests/test_web_access.py tests/test_remote_web.py
npm run build:studio
npm run test --workspace desktop
```

构建会检查登录首屏必要 JS/CSS 的 gzip 合计不超过 300 KiB。实际公网时延与浏览器吞吐另做测量，
不能把静态体积达标当作所有网络条件下三秒可交互的保证。
