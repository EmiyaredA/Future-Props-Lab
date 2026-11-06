# 云控 Happier 部署与切换

日常网站的 Agent 工作台使用自托管 Happier Web、SQLite Relay 与 CLI Runner。FPL 管理员通过云控解锁进入工作台，再用 Happier 原生设备密钥登录。Happier 保存加密会话，Runner 使用独立凭据执行。独立 Compose 的云控提供远程桌面。

## 隔离构建与配对

1. 从仓库根目录运行以下命令。两份镜像使用同一个固定的上游提交。Web 默认首次展开原生右侧文件面板。

   ```sh
   uv run python scripts/website/build_happier.py /absolute/path/to/happier --origin https://happier.example.com
   uv run python scripts/website/build_happier.py /absolute/path/to/happier --runner-tag fpl/happier-runner-e2ee:2aeb139d
   ```

2. 在隔离的 FPL 配置中启用 `[remote_web]`，为 Studio 和 Happier 分别配置同站 HTTPS 主机名。在 `[happier]` 填写 `origin`、`admin_user_id`、`listen_port` 和 `relay_port`。指定管理员同时列入 `[cloud_control].admin_user_ids`。配置升级时从现有 `[happier]` 移除 `oidc_client_secret`，随后用新版本检查配置。保留停机快照中的原配置供回退使用。
3. 先用 Mac 本机 HTTPS 代理验收。将 Studio 转发到 `[remote_web].port`，将 Happier 转发到 `[happier].listen_port`。保留原始 Host、Origin 和 WebSocket 升级，禁用缓存。同一 HTTPS Studio 来源遵循远程云控策略，需要启用 `[cloud_control].public_enabled` 并关闭 `public_desktop_vnc_only`。此时保持 `[website].public_enabled = false`，公网网关不发布 Happier 主机。
4. 用独立 Compose 项目、未使用的回环端口和专用项目目录验收。设置 `FPL_HAPPIER_ORIGIN`、`FPL_HAPPIER_RELAY_PORT` 和 `FPL_HAPPIER_PROJECT_ROOT`。Compose 使用新命名的加密数据卷。先临时允许设备密钥账号注册：

   ```sh
   FPL_HAPPIER_BOOTSTRAP_SIGNUP=true docker compose --project-directory deploy -f deploy/compose/happier.compose.yaml up -d relay
   ```

5. 指定管理员通过 Studio HTTPS 登录，在云控验证密码，打开 Happier 并创建原生账号。把恢复密钥保存在自己的密码管理器。执行 `docker compose --project-directory deploy -f deploy/compose/happier.compose.yaml run --rm runner happier auth login`，在已解锁的 Happier 浏览器中批准配对。用 Runner 内的 `codex login --device-auth` 准备隔离凭据。
6. 取消临时注册开关，重新创建 Relay 并启动 Runner：

   ```sh
   FPL_HAPPIER_BOOTSTRAP_SIGNUP=false docker compose --project-directory deploy -f deploy/compose/happier.compose.yaml up -d --force-recreate relay runner
   ```

7. 核验设备配对与恢复、新建 Codex 会话、首轮流式响应、审批同意和拒绝、文件访问、断线重连和重启后续聊。检查宽屏原生右栏、窄屏导航、切换桌面后的会话，以及 Runner 对项目之外宿主路径的读取限制。确认直接访问 Happier、错误账号和重放凭证都被拒绝，并核验 FPL 注销、撤权和解锁到期会关闭已连接的实时通道。

## 旧工作台归档与正式发布

1. 隔离验收通过后安排维护窗口。停止接受旧工作台操作，等待或明确结束正在运行的轮次。停止网站、旧 Agents Compose 服务及主机采集与执行进程。
2. 记录部署中实际使用的 Git 提交。用 `uv run python -m scripts.website.legacy_snapshot create` 封存停机的 FPL 运行目录及配置，保留命令返回的提交、文件数和清单摘要。若运行过独立 Agents 服务，另外封存其数据目录、服务配置与登记的外置原生会话文件，保留文件权限及原路径清单。备份和验收目录使用已确认被 Git 忽略的 `.local/` 或正式备份路径。旧记录只供恢复。
3. 使用 `legacy_snapshot restore` 和原清单摘要恢复到新的隔离目录。用原部署版本只读核对账号、会话与外置文件引用，保留原件和恢复副本。
4. 启动新版本与新 Happier 数据卷，先验收本机 HTTPS。独立 Compose 升级时停止并移除旧 Agents 容器，不带 `--volumes`，使用新 Gateway 路由和新的 Portal 构建，检查云控只显示远程桌面。
5. 本机验收完成后才发布公网 Happier 主机规则。沿用现有网关专用 SSH 回环转发，目标必须为 `[happier].listen_port`，原始 Relay 端口只绑定 Mac 回环。从外部浏览器重复验证解锁、实时连接、会话操作和撤权。
6. 如需回退，先撤下公网 Happier 路由，停掉新版本及 Runner，按归档提交和清单恢复到独立运行目录后再切回入口。保留新 Happier 卷和恢复密钥，避免丢失切换后创建的会话。

缺少隔离 Codex 凭据或任一运行验收失败时，正式发布保持待验收。
