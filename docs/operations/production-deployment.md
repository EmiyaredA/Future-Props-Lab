# Mac 单机网站部署

Future Props Lab 使用单台 Mac、一个后端进程和 SQLite；浏览器为唯一客户端。正式数据库与素材位于项目 `.runtime/`，配置固定在 `backend/config.toml`，两者均不提交 Git。

## 构建与运行

1. 安装 Node.js 24、npm 11、Python 3.11+、uv、Git LFS 与支持 H.264/AAC 的 FFmpeg/FFprobe，运行 `npm run setup`。验收结果为依赖安装与 LFS 资产检查成功。
2. 新安装按 README 创建配置与管理员；已有桌面数据必须使用原配置和原密钥，不能生成替代密钥。正式数据迁移工具是 `scripts/website/data_transfer.py`，要求显式提供源、项目和报告目录；在原实例正常停机、释放锁及迁移状态定稿后使用。迁移保留完整恢复快照，核验 SHA256、SQLite 与原数据，不执行 SQL 写入。
3. 将 `[website].web_root` 设为 `.local/studio-current/current`，运行 `uv run python scripts/website/frontend.py` 建立并校验首个共享构建。运行 `npm start`（或 `npm run dev`），本机固定通过 `http://127.0.0.1:3000` 登录，API 后端为 9001。
4. 运行 `npm run website:service -- install` 安装用户级 LaunchAgent。正式 Studio 的手动启动入口是 `npm run website:service -- start`。Mac 登录时使用同一份 LaunchAgent，`status` 显示实际运行路径。已固定线上版本的主机使用本机私有的启动登记，手动启动先核对登记、已安装定义和已加载定义，再复用或加载后台。两种启动方式都直接使用已有数据和构建。服务状态和 `/ready` 均成功才算启动完成。

正式入口在导入数据库前读取配置并持有 `.runtime/website.lock`。迁入后还持有原桌面目录的数据锁，阻止旧客户端误启动。存在待执行或漂移迁移时拒绝启动；迁移必须先在隔离数据验证，再按停机备份流程执行。服务不自动执行尚未核准的正式迁移。

使用 `npm run build:studio` 构建静态资源。主机可信监听和静态服务归 `studio/runtime/http/website.py`，
网站预检由 `scripts/website/serve.py` 执行。手动启动、停止、状态查询及安装管理使用 `npm run website:service`
的 `start`、`stop`、`status`、`install`、`uninstall` 子命令。历史桌面程序保留在归档分支。

日常开发和本机运行统一使用 `backend/config.toml` 与现有 `.runtime/`，不复制数据库、不生成替代密钥。`npm start`、`npm run dev` 以及兼容的 `dev:web` / `dev:backend` 都进入同一个进程管理器；后台服务也启动该入口。前端只监听回环 3000，后端固定回环 9001；端口占用时拒绝启动，不自动切换。后端 `/ready` 成功后才启动构建监听；任一子进程退出会清理整套服务。自动测试仍必须显式使用临时隔离数据库，不能读取现有数据。

前端源码变化触发串行构建。校验成功后原子切换，失败时继续服务当前构建。已打开的页面提示刷新；Uvicorn 只监视 `backend/` 与 `scripts/website/` 的 Python 代码，不监视数据目录。重载父进程持续持有数据锁，每个新 worker 在导入数据库运行时之前重新核验迁移；有未核准迁移时拒绝加载。重载会中断在途请求，不重新提交未知结果的模型任务。常规 TOML 或依赖变更需要正常停止并重新启动整套服务。可信本机的云控设置保存后，云控和编程智能体连接读取更新后的相关分组。

`scripts/website/development.py` 是共用单例启动器。本机前端、本机 API 与公网回环使用同一个 ASGI 应用和 Runner 生命周期。
`studio/assembly/website/public_access.py` 管理公网监听与专用 SSH，在网站生命周期结束时关闭。Compose 基础与叠加清单归
`deploy/compose/`。仓库清单的相对挂载以 `deploy/` 解析，封存清单以各自目录解析。管理装配继续识别迁移前登记的仓库基础清单路径。

## 公网

`[website]` 配置正式 `web_root` 和 `public_enabled`；统一启动入口对当前进程固定使用后端 9001，不改写持久配置和密钥。`[remote_web]` 保留精确 HTTPS origin、回环 28081、SSH 专用连接及导入凭据标识；`enabled` 为旧兼容字段，自动公网启动由 `website.public_enabled` 控制。

本机与公网共享同一份静态构建和业务进程。部署 `scripts/website/Caddyfile.shared`，先用 Caddy 校验再重载。网关只终止 HTTPS，并通过现有 SSH 隧道代理页面、静态资源与 API。公网探针核对实际转发到的实例与构建。确认两边的 `/ready` 和 `/build.json` 后，再清理旧本地发布快照与云端静态程序目录。专用凭据在 `backend/web-access/credentials/`，目录 0700、文件 0600。

本机与公网根据实际监听 socket 分流。浏览器使用 Session 并保留 Cookie、Origin、CSRF 和账号归属校验；CLI／SDK／MCP 使用 Management API Key，仅能调用明确登记的业务白名单和自动化发现／资源链接接口。公网管理员也不能管理主机目录、Codex 配置、磁盘或隧道设置。转发头不能授予本机权限。

`/v1`、私人媒体和 SSE 不进入共享缓存。Hash 程序资源长期缓存，HTML 和清单重新验证。Mac 离线时公网返回离线响应。WebSocket、SSE、上传、Range 和无缓存策略均需验证。

公网要求匹配的正式构建清单、哈希与压缩资源。网关转发网站和程序资源，Vite 只用于本地工具链。
HTML 回退仅适用于页面导航，未知 API 和缺失程序资源返回原错误。主机管理菜单只在可信本机入口显示。

## Schema 迁移与账号恢复

- 网站 SQLite 默认位于 `.runtime/future-props.db`。用 `npm run db:migrate:check` 查看迁移状态。
  待执行迁移先在隔离库验证并定稿，停机备份后显式执行 `npm run db:migrate`，再启动正式网站。
- Schema 由 `db/migrations/` 维护。只在 `versions/` 追加迁移并更新 `registry.py`。已登记的 ID、顺序、SQL 和 checksum 保持完整。
  Schema 或持久化兼容性变更同步更新 ORM、注册表、测试和数据／API 文档。迁移包独立于应用运行时，可执行 schema 所需的
  确定性数据变换。日常数据管理走正式 API。禁止绕过应用写入持久数据库或手工伪造迁移状态。
- `npm run account -- create-admin|create-user|reset-password` 是账号引导与离线恢复入口。
  账号创建和密码重置调用与 HTTP 共用的正式用例，账号与模型目录在同一事务创建。数据库恢复保留原加密密钥。

## 备份与恢复

每次正式数据迁移前，正常停止写入、服务和隧道，确认数据锁与数据库句柄释放。备份整个 `.runtime/`、`backend/config.toml`、`backend/web-access/` 和恢复同版本所需的代码、依赖、前端构建及接入凭据。本地模型、账号素材、历史和回收站随完整运行目录备份。日常启动、重启和状态查询无需生成迁移备份。

用停写后的封存数据生成迁移计划。逐文件比对 SHA256，检查 SQLite 完整性、外键和迁移账本，并确认备份的代码与构建能通过隔离启动预检。新备份验证通过后替换上一份完整备份，再开始正式导入。迁移失败时，用当次备份恢复对应的代码、配置、前端和完整数据，随后核对本机及公网的 `/ready` 和 `/build.json`。历史验收只保留报告。旧桌面来源按既有数据迁移验收规则保留。

备份涵盖 `accounts/`、`profiles/`、回收站、升级保留的旧文件与 `.runtime/local-models/`。
账号备份同时保留 `model-inference/inputs/`、`model-inference/outputs/`。
桌面迁入只从当时正在使用的 `Application Support/Future Props Lab` 取数，完整停机、备份和核验后迁入。
旧桌面目录及恢复快照保留到验收完成，禁止与仓库旧开发库合并。运行目录是正式数据，不作为迁移脚本或测试资产提交。

## 账号归属升级

- `0116_account_ownership` 是逻辑空间移除的唯一 schema 迁移，旧空间按唯一活动 Owner 归属；没有唯一 Owner 时拒绝迁移。
  历史迁移不改写，旧 Session 与 Management API Key 全部撤销。角色 `super_admin/admin` 合并为 `admin`，`member` 变为 `user`。
- 文件归属清单由 `studio/apps/asset_library/storage/layout/account_upgrade.py` 和正式布局 API 执行，路径为 `accounts/<user-id>/`。
  迁移期间仅允许身份与管理员布局升级接口，后台任务不启动；逐文件校验后落盘，拒绝链接和异内容覆盖，保留原文件作恢复副本。
  完成后必须重启应用；开发测试只使用隔离数据库，禁止自动升级或重启未核准的正式实例。

## 独立管理侧切换门禁

管理服务加入多服务部署时，必须先在隔离目录验证 Identity 的会话用途迁移、管理自有迁移、独立程序清单、管理与业务两条网关的来源边界、Mac worker 回执恢复，以及停止业务后 Identity/Models/Management 仍可用。使用管理 Compose 叠加清单，容器不挂 Docker Socket 或主机目录。正式数据的统一停机导出/导入与切换仍由多服务迁移流程执行；不得复制整个旧库或由开发启动命令自动迁移。旧 LaunchAgent 运行时新管理启动器拒绝安装或启动，不能自动接管正式实例。
