# 云控 Happier 部署

Happier 运行在 Mac 上的独立 Relay 和 CLI 容器中。使用新的 Relay 数据卷和一名指定的 FPL 管理员。无设备密钥账号采用明文会话存储，自托管 Relay 可以读取会话。测试项目和 CLI 凭据使用独立副本。

## 构建与配置

1. 用 `uv run python scripts/website/build_happier.py /absolute/path/to/happier --origin https://happier.example.com --relay-image <固定的上游 Relay 镜像>` 构建固定上游版本。构建只调整原生会话右栏的首次打开默认值。Happier 仍负责布局、拖动、收起和窄屏导航。
2. 在 `backend/config.toml` 设置 `[remote_web]` 的 HTTPS Studio 来源并启用该入口，配置 `[happier]` 的 `origin`、`admin_user_id`、`listen_port`、`relay_port` 和至少 32 字符的随机 `oidc_client_secret`。该账号同时列入 `[cloud_control].admin_user_ids`。同一 HTTPS Studio 来源无论本机还是外网都走 HTTPS 云控策略，需启用 `[cloud_control].public_enabled` 并关闭 `public_desktop_vnc_only`。可保持 `[website].public_enabled = false`，先从本机反向代理验收。
3. 让 Studio 和 Happier 使用同站的两个不同 HTTPS 主机名。Mac 本机 HTTPS 代理将 Studio 转发至 `[remote_web].port`，将 Happier 转发至 `[happier].listen_port`。保留原始 Host、Origin 和 WebSocket 升级，禁止代理缓存，并排除 OAuth 回调查询参数的访问日志。Relay 容器也需要通过该域名访问 OIDC 发现、令牌和公钥端点。验收通过后，通过现有公网网关和专用隧道接入这两个相同域名。Happier 原始 Relay 端口仅映射到 Mac 回环，浏览器始终走受控入口。
4. 为 Relay 提供仅含一个 FPL 客户端的 OIDC 配置文件。保留示例中的固定路径和客户端 ID，替换域名。通过环境变量提供与 FPL TOML 一致的密钥。

```json
[
  {
    "id": "fpl",
    "type": "oidc",
    "displayName": "FPL",
    "issuer": "https://happier.example.com/v1/cloud-control/happier/oidc",
    "clientId": "fpl-happier",
    "clientSecretEnv": "FPL_HAPPIER_OIDC_CLIENT_SECRET",
    "redirectUrl": "https://happier.example.com/v1/oauth/fpl/callback",
    "scopes": "openid profile",
    "fetchUserInfo": false,
    "storeRefreshToken": false
  }
]
```

5. 用 `docker build -t fpl/happier-runner:0.2.20 - < deploy/images/happier-runner.Dockerfile` 构建包含 Happier CLI 和 Codex CLI 的 Runner。使用 `deploy/happier.compose.yaml`，设置 `FPL_HAPPIER_ORIGIN`、`FPL_HAPPIER_RELAY_PORT`、`FPL_HAPPIER_OIDC_CLIENT_SECRET`、`FPL_HAPPIER_PROVIDERS_FILE` 和 `FPL_HAPPIER_PROJECT_ROOT`。需要其他 CLI 时可指定预装 CLI 的 `FPL_HAPPIER_RUNNER_IMAGE`，并准备归 UID/GID 1000 所有的 `/runner`。项目挂载只指向专用目录。CLI 配置与登录保存在独立 Runner 卷。
6. 用 `docker compose -f deploy/happier.compose.yaml up -d relay` 启动 Relay。在云控打开 Agent 工作台，通过原生 FPL 按钮进入 Happier。执行 `docker compose -f deploy/happier.compose.yaml run --rm runner happier auth login`，在已解锁的 Happier 工作区通过原生配对界面确认。按 CLI 自己的流程准备独立登录，再启动 Runner。

如需更换专用 FPL 管理员，使用新的 Happier 来源和新的 Relay 数据卷，避免复用原浏览器保留的 Happier 登录态。

## 放行检查

- 宽屏打开一个隔离 Codex 会话，确认左侧会话列表、中间对话和右侧文件面板。检查收起右栏后的偏好、窄屏导航以及切换回桌面时连接是否保持。
- 在本机和外网分别测试创建、流式输出、审批、文件访问、重连和续聊。试读未挂载的主机路径，确认 Runner 读不到主机目录和其他账号的 CLI 配置。
- 未解锁、错误账号、重放兑换凭证或绕过 FPL 访问时应拒绝。打开实时连接后分别测试注销、撤权和解锁到期。全部通过后才发布 Happier 公网路由。
