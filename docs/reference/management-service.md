# 独立管理服务

管理中台属于 `management` 服务，拥有自己的页面、SQLite、迁移、镜像和生命周期。它不直接访问 Identity、Models、素材或工坊的数据文件，也不启动业务 Runner。

## 页面与入口

管理端保留账号、邀请码、模型模板、演示服务、运行额度和审计页面，并提供应用运行与访问管理。原应用账号菜单仅保留个人设置和退出。

默认正式管理入口为 `http://127.0.0.1:9002/management`，独立开发入口为 `http://127.0.0.1:3001/management`。管理公网使用业务 HTTPS 站点的 `/management`，通过 Mac 回环 28083 和远端回环 28082 转发。管理浏览器通过 `/management/v1/*` 调用 API，管理网关将请求映射到服务的 `/v1/*`。公网可以治理账号和模型配置，主机启停、日志和隧道动作只接受 Identity 证明的真实本机管理会话。

Identity 是账号和会话的唯一真源。管理端使用 `fpl_management_session` 和 `fpl_management_csrf`，公网将两者限定在 `/management`。Identity 在自己的 `0002_management_sessions` 迁移中记录会话用途，复制 Cookie 值到另一入口仍会被服务端拒绝。同域页面属于同一个浏览器来源，Cookie 路径只限制发送范围。

## 命令与 API

- `npm run build:management`：构建独立管理页面及不可变清单。
- `npm run dev:management --workspace web`：只运行独立管理前端，代理已配置的管理入口。
- `npm start`：启动已配置的 Identity、Models 和 Management，再运行 Mac worker，按配置拉起业务服务。
- `npm run management:start`：运行管理服务和 worker，不自动启动业务组或业务公网。
- `npm run website:service -- install|start|stop|status|uninstall`：管理新的用户级启动器。安装前必须按部署流程停止旧启动器；安装命令不会自动卸载或接管正式旧服务。
- `npm run start:legacy` 与 `website:service:legacy`：多服务正式切换前保留的旧单体恢复入口，不能与新管理器同时管理同一业务部署。

管理服务在 `/v1/management/` 提供 runtime、application、application/actions、application/logs、access/{business|management}、对应 actions 和 jobs/{job_id}。动作请求必须带 UUID `request_id`。同一账号重复提交相同请求返回原回执；同一 ID 改变命令返回 409。管理 API 不进入 SDK/MCP 白名单。

浏览器直接经管理网关调用 Identity 的 `/v1/platform/accounts`、邀请码和审计接口，调用 Models 的模板、额度及演示服务接口。管理服务不代理任意 URL，不复制这些数据。本地模型的安装与运行面板位于管理端「服务管理」，业务模型页只保留接入与使用；公网管理会话不能执行本地模型主机动作。Identity 不可用时登录和新授权失败关闭；Models 不可用时相关治理页面显示请求失败，管理服务本身仍可运行。正式切换前须与 Models 的真实独立装配完成联调，不能以旧单体地址替代。

## 数据与原生控制

管理库仅包含迁移标记、`management_native_jobs` 和 `management_host_snapshot`。任务归提交管理员所有，结果未知不会自动重派。运维回执只属于管理服务，不写其他服务的审计表。

Mac worker 主动连接管理端专用回环通道。通道同时验证专用 ingress proof 和 worker 凭据；业务浏览器、管理浏览器和普通 API Key 都不能充当 worker。每次领取及实际执行前，管理服务向 Identity 复核原始请求，撤销或降权后拒绝执行。

worker 只运行固定 Compose 服务组的启动、SIGTERM、显式 SIGKILL、状态和限量日志命令。启动使用已选定的 Compose 配置并等待健康状态；不会自动换端口。后台观测独立于命令轮询；某个服务退出、缺失或健康检查失败时，仅报告未就绪的服务，保留其他服务和任务。恢复后观测状态自动更新，监督器不会自动停止或重启任何服务。只有明确的停止、重启或强制停止命令才改变服务组生命周期。Identity、Models 和 Management 不能加入可停止的业务组。停止先发 SIGTERM，30 秒未退出才允许用户另行确认强制停止；不会自动 SIGKILL。日志只读取固定服务组，限量并脱敏，不接受文件路径。

两个 SSH 子进程由 Mac worker 独立持有，使用专用密钥、严格 known_hosts 和固定远端回环转发。连接完成后，业务通过 `/build.json` 核对网关和构建，管理通过 `/management/build.json` 核对。停止业务组后仍可访问管理容器和管理隧道。

## 配置与切换

所有 Compose 调用显式传入 `--env-file /dev/null`，并禁用 `.env` 自动加载。持久配置真源为 `backend/config.toml`。`[management]` 声明本机来源和公网 HTTPS 来源，公网值只填来源，例如 `https://studio.futurepropslab.cn`，访问路径由管理网关提供。`[deployment]` 声明 Compose 项目与受限环境投影，`[management_host]` 声明本机 worker，`[management_remote]` 声明管理隧道。服务配置、Caddyfile 和凭据文件是带 0600 权限的部署投影。

使用 `deploy/compose/compose.yaml` 与 `deploy/compose/management.compose.yaml` 两份清单。Identity 增加独立管理网关凭据与来源，service credentials 中显式登记 management。管理镜像只获得 Identity 公钥、自己的服务凭据、worker 验证材料、自有数据库及只读路由/程序，不获得 Identity 私钥。

启动只核验自有 schema，不执行迁移。显式 `python -m studio.assembly.independent.management.cli migrate` 必须在停止对应管理实例后执行；Identity 自有迁移同理。新库必须由服务迁移初始化或通过已验收的正式导入流程建立，不能复制完整旧库。正式停机导出、导入、校验和切换由多服务部署流程统一完成；本任务的隔离验收不接通正式数据。

相关阅读：[配置参考](configuration.md)、[本地与公网访问](web-access.md)、[生产部署](../operations/production-deployment.md)。
