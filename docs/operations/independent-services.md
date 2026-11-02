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
npm run services:build:web -- portal
npm run services:build -- portal --build --web-release .local/service-web/portal/BUILD_ID
npm run services:build:web -- agents
npm run services:build -- agents --build --web-release .local/service-web/agents/BUILD_ID
```

当前独立镜像入口包含 Identity、Gateway、Agents、Portal、Assets 与 Rendering；其他服务的独立构建会明确拒绝。Gateway 包含 Caddy 与独立控制面，互相监督并持有自己的数据锁。构建器计算可审计源码闭包并拒绝单体入口、全部 ORM、工坊与模型内部依赖。镜像不复制整个后端，不打包配置、密钥、运行数据或仓库。Identity 自有锁文件固定所需依赖；版本由实际输入内容决定。

`deploy/compose.yaml` 目前装配 Identity、Agents、Portal、Assets、Rendering 和 Gateway，启动时只使用已构建镜像，不自动构建或迁移。数据库初始化必须通过所属镜像显式执行 `migrate`；已有数据库迁移历史不符时启动失败。`create-admin` 只接受标准输入 JSON，并且仅用于没有账号的新安装；已有正式账号应从受控导入保留。

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

早期本机全量 Web 组件测试曾出现随运行变化的编辑器超时。后续 Portal 批次在未调整超时配置的情况下，标准单 worker 全量运行 1795 项全部通过；最终后端全量 1843 项通过、4 项条件跳过。完整生产构建、代码、格式、契约与 SDK 检查通过。正式切换仍由剩余服务与数据导入验收阻止。

原生跟随任务结束后保留尚未确认的投影帧；重启不会擅自恢复已经结束的任务，也不会删除可能仅存于本机的未确认内容。

## 门户独立发布

Portal 只挂载自己的状态目录、存储配置和 Identity 公钥，不需要 FPL 加密密钥或其他服务凭据。首页、目录和文档有独立程序版本，目录仅依赖纯元数据。文档阅读器和现有指南复用原内容，SDK 的一行权限参考更新单独提交；原截图地址经过清单验证后跳转到门户版本资源，缺失文件仍返回 404。开发文档通过原账号授权 API 提供，不进入静态程序缓存。

为工作台验收增加 `--portal-image fpl/portal:VERSION`，会先验证门户页面，再重建、停止 Portal，检查其他进程启动时间不变、历史仍可读，并继续执行新的浏览器登录。正式维护前还需完成其余服务与 Identity 的独立账号管理页。

最终四容器与 Chromium 验收已通过：Portal 独立替换和停止后，Agents、Identity 与 Gateway 的启动时间不变，工作台历史及新登录继续工作；门户首页、目录、文档和明暗主题覆盖 390／768／1600px。

## Assets 拆分中的数据保护

Assets 已接通独立 HTTP、浏览器、镜像及 Compose，并通过五服务隔离验收；正式数据转移、业务引用调用方和其余服务仍未完成。原素材库没有变更。素材引用集合记录调用服务、资源类型、资源 ID、资源 revision 和自有 CAS revision；重试同一请求返回原回执，改变请求内容、回退版本或引用其他账号素材均拒绝。

跨服务作品提交先为本次修改建立独立准备意图，再在源应用同一事务保存作品和操作回执，最后确认素材引用。源应用只有证实未提交时才能撤销准备；取消请求或等待超时不构成回滚证明。未确认应用提交结果时保留各意图的素材，防止故障恢复丢失原件。确认乱序不覆盖更高源版本，也不释放较新准备意图的素材。删除素材或文件夹与全部已保存、准备中引用检查共享短写事务；文件删除任务在同一事务持久化，提交之后才逐文件执行。中断或文件系统拒绝不会丢失清理任务，已完成的 unlink 可以安全复核。私有协议已接通，源应用持久出站意图与恢复编排仍需接通。Assets 的文件与文件夹归档已在不含加密密钥的最小配置下验证；项目归属查询使用原账号请求委托和明确目标接口，身份或目标服务失败时停止操作，不回退到单体数据库。

引用准备意图、源引用 ORM 归属和新迁移的全量后端验证为 1881 项通过、4 项条件跳过；相关引用、存储、旧工坊与架构回归 89 项通过。Python 静态与格式、服务契约、Agent Note 与文档保护检查通过。独立 Assets HTTP 与容器验收仍未完成，不能据此切换正式数据。

## 正式切换门禁

仍需完成其余业务服务、独立前端、原生 Mac worker、跨服务回执、正式导出／导入、浏览器回归、完整质量门禁和资源验收。配置真源继续是项目 `backend/config.toml`；当前隔离测试生成的配置不能替换正式配置。

当前网站 `.runtime/` 是唯一正式迁移来源。原桌面目录、旧 Guacamole 数据卷、已验证的本地模型环境及停机快照继续保留。全部隔离验证完成后，才执行已批准的维护窗口与正式数据切换。

### 素材引用私有协议

`/_internal/v1/asset-retention/authorize` 只允许已登记源服务携自己的凭据和有效原始写请求断言调用。返回的授权仅对应一次引用修改；调用方在第一次请求 Assets 之前，必须持久保存授权、准备内容和请求 ID。不得把授权返回浏览器或放进日志。

`/_internal/v1/retention/prepare` 在接受新意图前向 Identity 复核账号及原 Session/API Key，短事务再检查 30 秒准备期限；确认和撤销只处理同一授权对应的意图。后续浏览器注销不妨碍已接受修改的结果确认，也不能用旧授权准备其他修改。未知结果只允许重放或查询原意图，不因超时撤销。私有接口不进入公共 OpenAPI/SDK 或公网网关；正式业务调用方和迁移导入仍未接通；Assets 镜像与页面已接通，五服务与 Chromium 验证已完成。

私有引用协议批次验证：全量后端 1886 项通过、4 项条件跳过；包含真实 Identity 登录、注销后拒绝新准备、旧意图结算、不可变回执、不同用途凭据拒绝、跳转拒绝和过期准备无写入。公共契约保持不变。

### 独立素材服务与管理端协调

素材服务拥有文件与目录、库素材的项目内引用位置、引用保留与删除队列；公开操作保留原 URL 和协议。项目文件夹删除只级联移除其位置记录，库中原件与作品／历史的保留 pin 分别校验。复制或上传在提交回执未知时保留字节，先核验文件列表和数据库结果，不自动删文件或重提。

用户确认管理端也使用独立数据库，通过 Identity、Models 等接口管理数据，不能采用另一任务最初提出的共享旧库方案。管理端接口完成后统一加入服务清单与 Compose。主目录还有并行热重载、UI 和会话升级改动；正式切换前必须保全并对齐其稳定版本。当前主目录的实际监听入口已由并行热重载任务调整为前端 3000／后端 9001，两个健康探针正常；切换前重新核对真实配置，不沿用旧 9000 假设。本分支未停止、重启或修改正式数据库。

本批验收：全量后端 1898 项通过、4 项条件跳过，随后新增缓存回归与相关场景 15 项通过；Web 279 个文件、1795 项全部通过，无未处理异常。代码、格式、公开契约与 SDK、官方导入包、构建、Agent Note 和文档保护检查通过。真实五服务运行 `fpl-isolated-agents-c94f0ac6be` 验证了上传、Range、缩略图、归档、独立替换、SIGKILL 后恢复、SQLite 完整性与外键、停止门户后的素材读取和新登录，以及 Mac 原生采集继续同步。390／768／1600 的明暗主题检查已通过，手机按钮实际文字保持一行且触控高度至少 44px。

已验证素材镜像为 `fpl/assets:85ff1dcf822cdde1e634`，浏览器版本 `6cec58bc6573604493c9`；Identity 为 `fpl/identity:cc7eb193964e94f67ca3`，Gateway 为 `fpl/gateway:7f9f8b1f8312af6f4db7`。这些仅为隔离验收版本，尚未安装到正式数据。后续合入主目录已提交的新界面、文件预览与功能退役改动后，需要重新核验契约和依赖边界，不能用这一批报告代替最终切换验收。


## 文件预览与 Rendering 联调

已对齐主目录提交至 `8f7b148b` 的首页、进度反馈、响应式图片、文件真实预览及测试工具退役改动；受保护文档参考保留为独立提交。独立页面的图片与生成缩略图使用所属服务版本前缀，不能依赖门户在线托管其他服务的资源。

构建 `npm run services:build -- rendering --build` 后，在工作台容器验收命令增加 `--assets-image fpl/assets:VERSION --portal-image fpl/portal:VERSION --rendering-image fpl/rendering:VERSION`。此时预览、缩略图、媒体信息、裁剪和取帧由 Rendering 独立容器承接；它通过受限原请求委托读取 Assets 的同一账号素材，不挂载素材卷或数据库。验收使用合成媒体，包含真实 FFmpeg、PDF、文本与中文名称、音频波形、宫格导出及独立重建。Assets 另验证 40 MiB 上传和 ZIP 导入。

这只是 Rendering 的媒体处理接口切片。确定性时间线导出、持久任务恢复、其余工坊与正式导入尚未完成；全部通过前继续使用原正式实例。

网关运行日志通过 [Caddy 全局日志配置](https://caddyserver.com/docs/caddyfile/options#log)和 [filter](https://caddyserver.com/docs/caddyfile/directives/log#filter) 删除请求及响应头。默认敏感头规则不能覆盖自定义身份断言；SSE 取消和上游故障也不得把断言写进错误日志。实际容器验收检查错误日志中没有身份头和 JWT。


### Rendering 批次最终验收

代码提交 `c5b37431` 已同步远程。真实六服务最终运行 `fpl-isolated-agents-a14698a687` 通过：账号登录、原生跟随、独立重建与停止、40 MiB 上传、ZIP 导入、Range、视频／音频／PDF／中文文本预览、帧 ZIP 与宫格、SQLite 核验、门户停止后的新登录和响应式明暗页面。网关错误与取消流日志不再输出请求头或身份断言。手机与桌面截图已检查。

该批完整后端 1934 项通过、4 项条件跳过；生产构建、契约及 SDK、格式、静态、官方导入包、Agent Note、受保护文档提交隔离和 Git LFS 检查通过。Web 原长用例按独立旅程调整后，标准单 worker 全量 283 个文件、1825 项通过，无未处理异常；保留原断言与超时。后续 Models 目录接口准备的隔离及兼容回归另有 73 项通过。正式实例与数据未切换。
