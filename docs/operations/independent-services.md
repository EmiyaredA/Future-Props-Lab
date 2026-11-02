# 独立服务迁移与隔离验证

本轮正在把网站单体迁为同仓库的独立服务。正式网站仍由网站入口运行；未完成所有服务、数据导入与恢复验收前，不停止正式实例，不连接或迁移正式数据库。

## 已实现的运行边界

Identity 使用自己的 `service.db`、迁移注册表、配置、启动锁和进程生命周期。账号、Session、API Key、邀请码及安全审计沿用现有领域用例；创建账号在同一事务中记录目录初始化事件，不加载模型 ORM 或写 Models 数据库。事件投递和 Models 消费仍需接通后才能开放完整新服务部署。

Gateway 从公共操作归属清单生成精确的方法和路径路由；未知 API 与内部接口返回 404。Gateway 按实际的两个监听器标记本机和公网，先移除外部身份头，再向 Identity 请求短期、绑定目标服务与请求路径的签名上下文。业务服务不能依据 Host 或转发头取得主机权限。

预认证使用 Caddy 的 [forward_auth](https://caddyserver.com/docs/caddyfile/directives/forward_auth)；API 的禁止缓存响应头在上游响应后覆盖，使用官方 [header 延迟写入](https://caddyserver.com/docs/caddyfile/directives/header)能力。Identity 自行校验 Session、账号状态、CSRF 和固定权限。长期连接可通过受限服务凭据重新检查原签名断言，撤销或身份服务不可用时停止授权。

## CLI 构建

```sh
npm run services:contracts:check
npm run services:build -- identity --build
npm run services:build -- gateway --build
npm run services:build:web -- agents
npm run services:build -- agents --build --web-release .local/service-web/agents/BUILD_ID
```

当前独立镜像入口已完成 Identity、Gateway 与 Agents；其他服务的独立构建会明确拒绝。Gateway 包含 Caddy 与独立控制面，互相监督并持有自己的数据锁。构建器计算可审计源码闭包并拒绝单体入口、全部 ORM、工坊与模型内部依赖。镜像不复制整个后端，不打包配置、密钥、运行数据或仓库。Identity 自有锁文件固定所需依赖；版本由实际输入内容决定。

`deploy/compose.yaml` 目前装配 Identity、Agents 和 Gateway，启动时只使用已构建镜像，不自动构建或迁移。数据库初始化必须通过所属镜像显式执行 `migrate`；已有数据库迁移历史不符时启动失败。`create-admin` 只接受标准输入 JSON，并且仅用于没有账号的新安装；已有正式账号应从受控导入保留。

## Docker 隔离验收

将构建命令输出的镜像传入：

```sh
npm run services:test:docker -- --image fpl/identity:VERSION --gateway-image fpl/gateway:VERSION
```

脚本在被忽略的 `.local/service-split/` 下生成独立数据、测试账号和只读配置，使用随机的 Compose 项目名及 19000／19081 回环端口。它不读取正式配置、密码或数据库。测试结束停止并删除本次容器与网络，保留经过脱敏的日志、报告和恢复快照。

脚本覆盖登录、CSRF、Host／Origin、未知 API、实际监听器权限、重复启动、独立重启、SQLite WAL、完整停机恢复、容器重建与注销。签名转发使用只在测试 Compose 覆盖中存在的协议探针验证；该探针不属于 Agents 实现，不打包进正式镜像，也不能代替工作台或远控业务验收。

所有 Compose 调用显式使用 `--env-file /dev/null`。业务服务仅连接内部网络，没有宿主发布端口；Gateway 另连入口 bridge，仅发布浏览器两个入口及原生采集专用的 127.0.0.1:29090 入口。每个服务只绑定自己的数据目录及最小只读配置，禁止用户主目录和 Docker Socket。Gateway 的官方 Caddy 二进制带低端口文件能力，当前显式保留该单项容器能力以保证可执行，其余能力均移除。

## 工作台与原生采集验收

```sh
uv run python scripts/website/agents_docker_smoke.py \
  --identity-image fpl/identity:VERSION --agents-image fpl/agents:VERSION \
  --gateway-image fpl/gateway:VERSION --browser
```

此项使用真实独立工作台容器与 Mac 采集进程，原生来源为测试生成的日志，不读取个人 Agent 历史。验证独立替换容器后的历史、检查点、增量同步与新账号登录；确认工作台库不含账号或其他工坊表。`--browser` 使用真实 Chromium 验证无门户进程时的新登录、历史阅读、旧链接、主题、390／768／1600px 布局和未保存确认。先将 Chromium 安装至项目忽略目录：`PLAYWRIGHT_BROWSERS_PATH=$PWD/.local/playwright-browsers npx playwright install chromium`。

Mac 采集 CLI 为 `uv run python -m fpl_host collect --connection PATH --state-root PATH`。连接描述是受保护配置投影，只含回环 URL 和限定 worker 凭据，要求当前用户所有及 0600 权限；它不是配置真源。正式启动协调器与投影生成仍待完成，不手工配置正式凭据。

原生入口拒绝浏览器 Origin，浏览器入口不转发私有协议。网关使用独立原生通道证明，采集器再提供 worker 凭据；工作台不持有网关的 Identity 凭据。任务持久化账号、请求 ID、租约和不可变结果；领取使用 SQLite CAS，空队列轮询不持有写锁。未知结果不重派。跟随任务按当前来源版本和账号授权复核，单帧回执与检查点在同一短事务提交；确认丢失可重发原帧，暂停和解除绑定拒绝旧任务写入。原生文件不改写。

工作台的长期 SSE 通过 Identity 复核原会话；账号不可用时关闭流。原生采集器离线保留阅读副本并提示状态。普通业务上游只收到绑定该请求的签名上下文，网关移除原 Session Cookie 和 Authorization，避免完整浏览器凭据落入业务服务。

## 网关委托与独立程序版本

网关能力发现读取固定的聚合契约。资源链接通过明确的 GET 查询所属服务，身份服务只为预先登记的调用方、来源操作和用途签发目标断言，注销后拒绝继续委托。变更通知使用独立发布方凭据、事件 ID 和持久回执，不读取其他服务的数据库；各业务服务的通知发件箱仍需随后接通。

工作台页面只包含自身入口、账号组件与阅读功能，程序 URL 为 `/_apps/agents/BUILD_ID/`。构建生成逐文件哈希与压缩副本，镜像封装时再次核验；不挂载源码。启动还校验页面的单服务 API 哈希。旧页面版本只会被相应服务拒绝写入，其他应用和不携带浏览器版本标记的 SDK 保持原公共契约。缺失资源与未知 API 返回 404。旧 `/apps/agent-workbench` 链接按 [Caddy redir 语法](https://caddyserver.com/docs/caddyfile/directives/redir) 显式指定匹配器，跳转到 `/agents`。

Gateway 的 Mac 公网访问管理桥接、服务状态聚合和各服务的通知发件箱尚未完成；相应管理调用会明确返回组件不可用。它们属于正式切换门禁，不能用当前隔离验收替代。

## 当前批次验证记录

Gateway 与 Agents 独立浏览器入口批次已通过全量后端 1822 项测试（4 项按条件跳过）、代码检查、格式检查、聚合契约与 SDK 检查，以及真实三容器与 Chromium 验收。浏览器验收对确认后的实际 URL 和原生弹窗进行断言，避免只检查旧页面仍存在而误报跳转成功。

本机全量 Web 组件测试为 1787 通过、8 失败；五个失败文件单独复核为 33 通过、1 项 15 秒超时。失败项目与耗时随运行变化，目前仍视为未通过的完整门禁；不能用定向通过代替，也不调整产品逻辑来掩盖运行超时。正式切换继续被阻止。

原生跟随任务结束后保留尚未确认的投影帧；重启不会擅自恢复已经结束的任务，也不会删除可能仅存于本机的未确认内容。

## Assets 拆分中的数据保护

Assets 的独立文件用例和初始 schema 目前只用于隔离验证，尚未作为完整服务加入 Compose。原素材库没有变更。素材引用集合记录调用服务、资源类型、资源 ID、资源 revision 和自有 CAS revision；重试同一请求返回原回执，改变请求内容、回退版本或引用其他账号素材均拒绝。

跨服务作品提交采用先保留旧、新素材并集、再提交所属应用、最后收敛引用集合的顺序。未确认应用提交结果时保留并集，防止故障恢复丢失原件。删除素材或文件夹与引用检查共享短写事务；文件删除任务在同一事务持久化，提交之后才逐文件执行。中断或文件系统拒绝不会丢失清理任务，已完成的 unlink 可以安全复核。各调用方的正式接口与恢复编排仍需接通。

这一批全量后端为 1831 项通过、4 项条件跳过；最新素材专项 10 项通过，相关旧工坊、存储和架构回归 83 项通过。代码、格式、契约、SDK、Agent Note 与文档保护检查通过。

## 正式切换门禁

仍需完成其余业务服务、独立前端、原生 Mac worker、跨服务回执、正式导出／导入、浏览器回归、完整质量门禁和资源验收。配置真源继续是项目 `backend/config.toml`；当前隔离测试生成的配置不能替换正式配置。

当前网站 `.runtime/` 是唯一正式迁移来源。原桌面目录、旧 Guacamole 数据卷、已验证的本地模型环境及停机快照继续保留。全部隔离验证完成后，才执行已批准的维护窗口与正式数据切换。
