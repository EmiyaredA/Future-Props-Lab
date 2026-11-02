# Mac 单机网站部署

Future Props Lab 使用单台 Mac、一个后端进程和 SQLite；浏览器为唯一客户端。正式数据库与素材位于项目 `.runtime/`，配置固定在 `backend/config.toml`，两者均不提交 Git。

## 构建与运行

1. 安装 Node.js 24、npm 11、Python 3.11+、uv、Git LFS 与支持 H.264/AAC 的 FFmpeg/FFprobe，运行 `npm run setup`。验收结果为依赖安装与 LFS 资产检查成功。
2. 新安装按 README 创建配置与管理员；已有桌面数据必须使用原配置和原密钥，不能生成替代密钥。正式数据迁移工具是 `scripts/website/data_transfer.py`，要求显式提供源、项目和报告目录；在原实例正常停机、释放锁及迁移状态定稿后使用。迁移保留完整恢复快照，核验 SHA256、SQLite 与原数据，不执行 SQL 写入。
3. 运行 `npm run build:studio`；产物在 `.local/studio-release/`，附构建标识、清单和预压缩文件。运行 `npm start`，本机通过 `http://127.0.0.1:9000` 登录。
4. 运行 `npm run website:service -- install` 安装用户级 LaunchAgent。用 `status` 查看，`stop` 卸载本次运行，`start` 重新加载；`uninstall` 移除自动启动。服务状态和 `/ready` 均成功才算启动完成。

正式入口在导入数据库前读取配置并持有 `.runtime/website.lock`。迁入后还持有原桌面目录的数据锁，阻止旧客户端误启动。存在待执行或漂移迁移时拒绝启动；迁移必须先在隔离数据验证，再按停机备份流程执行。服务不自动执行尚未核准的正式迁移。

开发使用 `npm run dev`、`.local/dev-runtime/` 与 9001 端口；首次启动生成独立的 `.local/dev-runtime/backend/config.toml` 与加密密钥，不读取正式配置；不要让开发或自动测试连接正式库。后端更新需要显式重启服务，不重新提交未知结果的模型任务。

## 公网

`[website]` 配置本机 `port`、正式 `web_root` 和 `public_enabled`。`[remote_web]` 保留精确 HTTPS origin、回环 28081、SSH 专用连接及导入凭据标识；`enabled` 为旧兼容字段，自动公网启动由 `website.public_enabled` 控制。

公网监听器关闭 lifespan，复用同一个 ASGI 应用、数据库和 Runner；云端只终止 HTTPS 并托管匹配的程序资源。先发布相同构建，再启用公网；版本不匹配时本机可用、公网拒绝启动。专用凭据在 `backend/web-access/credentials/`，目录 0700、文件 0600。不要启用旧自动隧道。

本机与公网根据实际监听 socket 分流。浏览器使用 Session 并保留 Cookie、Origin、CSRF 和账号归属校验；CLI／SDK／MCP 使用 Management API Key，仅能调用明确登记的业务白名单和自动化发现／资源链接接口。公网管理员也不能管理主机目录、Codex 配置、磁盘或隧道设置。转发头不能授予本机权限。

`/v1`、私人媒体和 SSE 不进入共享缓存。Hash 程序资源长期缓存，HTML 和清单重新验证。Mac 离线时云端页面可读取，业务操作显示离线。WebSocket、SSE、上传、Range 和无缓存策略均需验证。

## 备份与恢复

正常停止服务和隧道，确认数据锁与数据库句柄释放，再完整备份 `.runtime/`、`backend/config.toml` 与 `backend/web-access/`；本地模型、账号素材、历史、回收站及旧文件一并保留。不得只复制 SQLite 主文件。

升级先备份并核验，再更新代码、冻结依赖和构建资源。回滚必须恢复同版本的代码、配置及整个数据快照，不能手工修改迁移记录。旧桌面目录和网站化迁移快照在完成浏览器验收、验证回滚之前保留。

## 独立管理侧切换门禁

管理服务加入多服务部署时，必须先在隔离目录验证 Identity 的会话用途迁移、管理自有迁移、独立程序清单、管理与业务两条网关的来源边界、Mac worker 回执恢复，以及停止业务后 Identity/Models/Management 仍可用。使用管理 Compose 叠加清单，容器不挂 Docker Socket 或主机目录。正式数据的统一停机导出/导入与切换仍由多服务迁移流程执行；不得复制整个旧库或由开发启动命令自动迁移。旧 LaunchAgent 运行时新管理启动器拒绝安装或启动，不能自动接管正式实例。
