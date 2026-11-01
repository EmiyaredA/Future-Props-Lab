# 单机生产部署

Future Props Lab 的受支持生产形态是单台主机、单个后端进程和单个 SQLite 数据库。不要把后端启动为
多个 worker，也不要让多台主机共享 `.runtime/future-props.db`。

## 构建与启动

1. 安装 Node.js 24、npm 11、Python 3.11 或更高版本、Git LFS，以及系统级 FFmpeg/FFprobe。
2. 运行 `git lfs install` 和 `git lfs pull`，再执行 `npm ci`、`uv sync --frozen --all-groups` 与
   `npm run lfs:check`。生产字体或 VAD 对象缺失/损坏时不得继续构建。
3. 新安装从 `backend/config.example.toml` 创建 `backend/config.toml`，生成并离线备份 `security.secrets_key`。
   旧安装运行 `npm run config:migrate -- --check` / `--apply`，保留原密钥。
4. 执行 `npm run db:migrate:check`，确认迁移状态有效。
5. 根据反向代理路径设置 Web 构建变量 `VITE_API_BASE`，然后运行 `npm run build`。同源部署应留空，
   跨源部署应填写 API 的 HTTPS 根地址。它不是后端 `.env` 变量。
6. 使用 `npm run start:backend` 启动单 worker 后端。用 systemd、launchd 或等价进程管理器负责重启
   和标准输出收集，不要在生产环境使用 `--reload`。
7. 由 Nginx、Caddy 或等价服务器直接托管 `web/dist/`，未知前端路由回退到 `index.html`。

## 反向代理

- 将 `/v1/`、`/health`、`/ready` 和 `/docs` 转发到 `127.0.0.1:9000`。
- `/v1/model-test/realtime` 必须允许 WebSocket upgrade，并保留 `Origin`、`Host` 和 Cookie。
- HTTPS 环境将 `FPL_AUTH_COOKIE_SECURE=true`，并把实际 Studio 来源加入 `CORS_ORIGINS`。
- 不要在代理日志中记录 Authorization、Cookie、CSRF、上传正文或供应商响应正文。
- 存活探针使用 `/health`；只有数据库和全部后台 Runner 就绪时 `/ready` 才返回成功。

## 备份

桌面版提供可选的同进程 Studio Web 入口，详见下文；公网网关不能直接转发
Electron 的随机私有端口或 Vite 开发端口。

备份前停止应用。数据库文件和数据库同级的以下目录必须作为同一快照复制：

- `workspaces/`、`profiles/`、`library/assets/`、`applications/`
- `model-test/attachments/`、`model-test/references/`、`model-test/generated/`

默认位置是 `.runtime/`。同时安全备份 `backend/config.toml` 中的 `security.secrets_key`，但不要把它放入代码
仓库或普通构建产物。仅复制 SQLite 主文件而遗漏素材目录不构成可恢复备份。

## 升级与回滚

升级时先停止应用并完成全量快照，再更新代码、拉取所需 LFS 对象、执行冻结依赖安装、
`npm run db:migrate:check` 和 `npm run build`，最后启动并验证 `/health`、`/ready` 及登录。应用启动
会自动应用已登记迁移。

若启动前失败，可直接恢复旧代码。若新版本已经写入数据库或执行迁移，回滚必须在停机状态下同时
恢复升级前的数据库和所有运行期目录；不得手工修改 schema、`schema_migrations` 或迁移 checksum。

## 运维凭证

`FPL_MANAGEMENT_API_KEY` 是管理员在产品内创建、只展示一次的短期调用凭证。需要运行正式 API
客户端脚本时，通过该进程的环境变量临时传入，完成后立即清除或吊销。它不是后端启动配置，严禁
写入 `backend/config.toml`、Shell 历史、日志或文档示例。

## 桌面同进程 Studio Web 入口

在桌面数据目录的 `backend/config.toml` 中增加 `[remote_web]`：`enabled = true`、
精确 HTTPS `origin`、`port = 28081`，以及绝对 `web_root`。默认关闭，只监听
127.0.0.1；不是另一个 worker，不复制数据库或重新启动后台 Runner。

开发桌面可运行 `npm run build:studio`，将 `web_root` 指向仓库的
`.local/studio-web`。该构建忽略 Web `.env`、使用同源 API、关闭源码映射和
公网邀请码注册入口。打包版可留空 `web_root` 以复用随包静态页；公网仍关闭
注册 API。原本的桌面账号与项目由同一进程提供，退出应用即停止公网入口。

反向代理保持 `Host` 为所配置来源、保留原始浏览器 `Origin`，不要注入桌面
token 或 Agent 通道头。公网接入按实际绑定 socket 分流，强制浏览器 Session，
保留原权限／CSRF／限速；桌面初始化、配对、私有 UI 与原始 API 文档不可访问。
公网响应中的认证 Cookie 增加 Secure，仍是 host-only；桌面 HTTP Cookie 行为不变。

配置应用遵守桌面已有停机备份与未保存编辑保护。仅使用一个 SSH 反向隧道，
公网数据库、业务监听端口不开放；云端 HTTPS 终止仍属于在线流量信任边界。
