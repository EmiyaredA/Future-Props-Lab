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

当前独立镜像入口包含 Identity、Gateway、Agents、Portal、Assets、Rendering、Management、Models 与 Integrations；其他服务的独立构建会明确拒绝。Gateway 包含 Caddy 与独立控制面，互相监督并持有自己的数据锁。构建器计算可审计源码闭包并拒绝单体入口、全部 ORM、工坊与模型内部依赖。镜像不复制整个后端，不打包配置、密钥、运行数据或仓库。Identity 自有锁文件固定所需依赖；版本由实际输入内容决定。

`deploy/compose.yaml` 目前装配 Identity、Agents、Portal、Assets、Rendering 和 Gateway，`deploy/management.compose.yaml` 提供独立管理端叠加清单；Models、Integrations 和 Thought 使用显式选择的 `deploy/models.compose.yaml`、`deploy/integrations.compose.yaml` 和 `deploy/thought.compose.yaml`。启动只使用已构建镜像，不自动构建或迁移。数据库初始化必须通过所属镜像显式执行 `migrate`；已有数据库迁移历史不符时启动失败。`create-admin` 只接受标准输入 JSON，并且仅用于没有账号的新安装；已有正式账号应从受控导入保留。

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

Gateway 的 Mac 公网访问管理桥接和各服务的通知发件箱尚未完成；相应管理调用会明确返回组件不可用。服务状态聚合已接入 Management 的受限观测接口，见下文；其余门禁不能用当前隔离验收替代。

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

### 同条件性能对照

- [ ] 在同一台机器用等价隔离数据、同一并发和固定模型响应，对比兼容单体与完整候选提交。记录两个提交、镜像、机器、数据集摘要、并发、预热规则和缓存状态，避免同时运行两套服务抢占资源。可提前采集单体基线，候选就绪时复核条件。
- [ ] 逐旅程采集端到端样本。登录后首屏以登录提交至登录态首屏可用为止，Thought 带素材保存以保存提交至引用校验后的写入回执为止，Creative 安装以确认至安装回执为止，Models SSE 以发起请求至首个有效业务事件为止，素材预览以发起请求至首个响应体字节为止。
- [ ] 逐旅程报告样本数、端到端 p50/p95、错误率和候选减基线的差值，延迟同时报告毫秒与相对变化，错误率差值用百分点。把错误和超时纳入分母，附原始样本和复跑条件。
- [ ] 对可复现的明显回归分段采样，区分网关鉴权、服务间调用、业务处理和文件或供应商等待。修复可归因问题后按相同条件复测，将结论和原有门禁证据一起纳入维护窗口材料。

既有隔离报告可作为功能证据。当前性能门禁待同条件采样和对照报告。

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


### 管理端整合

稳定管理分支 `6e993a38` 已按独立数据库方案整合。管理页面、Session 用途、原生通道和 Compose 叠加清单独立保留；Assets/Rendering、响应式资源和查询参数兼容也保留。生成清单由正式生成器重建，未选择任一侧覆盖。合并后的身份／管理／媒体／架构检查 85 项通过，类型检查及 76 项 Web 回归通过；管理镜像 `fpl/management:868a3335d02f6b1724aa` 与 Identity `fpl/identity:d39152b59b4ed051d88b` 的真实隔离验收 `management-real/bbd6b10d36` 通过。业务停机用的是合成 HTTP 容器，不能代替 Models 真实联调。

监督器原有的组故障清场策略已调整：退出、缺失或不健康只产生状态反馈，不自动停止其他服务；服务恢复后自动更新观测。对应 21 项管理／主机检查通过。Compose 明确禁用 dotenv。当前启动命令指向新协调器，旧网站保留 `start:legacy` 和匹配归档；未通过剩余门禁前不安装到正式实例。

### 应用状态与 Models 隔离准备

应用卡片显示运行、启动、停止、暂停、重启、健康检查失败、退出异常、不可达、未部署、未知和依赖异常，并可展开说明。Gateway 综合就绪探针与 Mac 管理 worker 的新鲜生命周期观测；只有主机证据能确认停止或未部署，连接失败不直接表示已停止，刷新失败时旧结果标为历史。此读取仅开放浏览器 Session，普通账号不因此取得日志、主机路径或运维权限。真实七容器验收覆盖停止／恢复 Portal、工作台继续使用及状态变化，页面已核对明暗和手机／平板／桌面布局。

Models 已具备 23 张自有表、追加迁移、独立默认值 CAS、显式目录存储与调用归因绑定、应用会话工厂，以及按账号提交的生成／转录恢复。推理输入与输出恢复只核对自己的目录和记录，不读取账号表或其他应用数据。旧数据库迁移与物理外键保持原样；这些准备不等于 Models 已可部署。

独立配额策略与额度账本只使用 Models 自有记录，保留账号、语音、实例上限及管理员预留。恢复后缺少额度记录的活动任务仍消耗容量，关联创建失败可整体回滚；不存在按时间释放未知供应商结果的行为。启动前恢复只释放已失去进程的同步调用额度，持久任务必须确认完成才结算。排队执行的有效账号授权、Runner 结算、治理 HTTP 与审计投递尚未完整装配，不能用配额账本替代这些门禁。

待提交任务已具备独立的原始请求与输入摘要存储，以及出队前的 Identity 复核适配器。正常 HTTP 注销、停用、角色变更与 Key 撤销会阻断新提交；授权服务暂不可用保留排队任务。供应商已接受的任务继续按原 ID 查询／落盘，不把结算当作一次新提交。短期本地决定每次领取前重新取得，超过五秒则延后并重新检查；不缓存账号权限供后续任务复用。完整 Models HTTP、各 Runner 与原生／素材／供应商端口尚未全部接通，不可提前发布到正式数据。

推理输入导入与文件库音频转录已改用显式素材读取端口。独立实现经私有 HTTP 复制当前账号的文件库文件，原库文件保持不变；跨账号、项目专属素材、浏览器直接访问和缺少装配均拒绝。读取不持有 Models 写事务，传输大小与描述不一致时撤回未提交文件。取消在提交前清除暂存；提交已可能成功时保留输入文件供所属服务核对，避免留下有记录却丢失内容的任务。当前仍未完成输出回存、生成素材、供应商／演示管线及原生 worker 的全部隔离，因此 Models 继续不提供正式镜像入口。

模型 HTTP、实时语音与派生任务的额度生命周期通过当前 ASGI 应用显式装配，恢复网站安装原治理账本。缺少绑定拒绝新任务，幂等重放仍只读取本账号已有回执、不申请新额度。Models 自有额度账本、供应商演示运行、素材接口、原生任务授权和完整服务装配仍在实施，正式数据与现有网站保持原状。

服务迁移预检在只读连接核对历史位置、服务、版本和 checksum，并在打开目标连接后再次验证，再进行可写设置；不修补历史。文件路径按 URI 转义。无 WAL 时避免仅检查就生成空的 WAL／SHM，有 WAL 时读取其已提交历史，不能用 immutable 隐藏它。该修正的最终后端回归 2037 项通过、4 项条件跳过，七个镜像及合成数据的容器／浏览器验收 `fpl-isolated-agents-c99f192791` 通过，未触碰正式数据。

Identity 的账号目录事件已具备 Models 专用的私有轮询／确认接口。Models 在自己的账号事务中初始化目录并保存摘要回执，提交后才确认源事件。新初始化使用短期当前角色状态，停用事件保留待恢复；重复或结果未知的提交不会重新播种或改写已有目录。完整服务装配仍须接入自有角色模板策略。该批最终后端 2052 项通过、4 项条件跳过，真实七容器／浏览器验收 `fpl-isolated-agents-3944ec7a72` 通过；未安装到正式实例。

自有角色策略与初始化回调现已接通：Models 追加独立角色策略表，密钥仅加密保存，视图脱敏，保存使用 CAS；目录合并保留已有 ID、自建项和有效默认选择，活动任务阻止冲突修改。恢复网站继续使用自己的设置／授权／审计适配，不依赖独立库。该批后端全量 2059 项通过、4 项条件跳过，公开契约与 SDK 不变；治理 HTTP、跨服务审计、同步授权及剩余运行能力仍需完成。


模型库输入批次已通过后端全量 2130 项（4 项条件跳过）、静态与格式、公共／独立契约和 SDK 检查。七服务容器与浏览器验收 `fpl-isolated-agents-ad03015969` 覆盖 Identity 到 Assets 的私有文件流、用途与路径绑定、中文文件名和原始字节，同时验证原生采集、素材与渲染、独立重建、门户停止后的新登录和响应式页面。此记录只证明该素材读取切片，不代表完整 Models 或全部业务服务已装配，也未切换正式数据。


### Models 结果与私有参考

生成参考与模型结果的消费者已不再直接查询 Assets ORM；恢复网站仍通过显式适配读取旧引用。正式转移前需在旧站调用 `generation-assets/backfill-status`／`generation-assets/backfill`，确认所有需要保留的历史参考已转换成 Models 自有文件；活动任务须先安全结束。独立服务不会在缺少转换时尝试跨库读取。

独立结果保存使用固定来源 `POST /v1/model-inference/tasks/{task_id}/save-to-library` 与绑定描述摘要的私有 Assets 流式目标。两端均不返回存储路径；Assets 校验长度和内容 SHA256，接收后再次核验身份，在短事务中保存文件及收据。对同一结果的重复保存返回同一文件；文件已删除时返回冲突，不默默重建。提交响应丢失时保留本地结果并重试原回执，不再次调用供应商。新协议、回填错误映射、旧兼容入口和生成文件提交保护的定向测试已通过，最终容器与整体验收由集成批次统一执行。


### Models、Integrations 与 Thought 边界批次

Models 已独立装配目录与治理、初始化事件、任务执行与配额、审计回执、文本与实时语音。私有输入按原账号和用途读取 Assets；生成参考只保存本服务字节。推理结果回存使用同一任务和内容摘要的幂等素材回执。Mac worker 通过租约传输参考与结果，不挂载容器库；完成回执前串行提交最新模型观测，避免旧观测覆盖安装成功。输出描述使用 `X-Model-Output-Descriptor`，网关继续删除全部外部 `X-Fpl-*` 身份头。

Integrations 已独立装配工具、MCP、Skills 和外部连接。Identity 固定意图绑定原请求、账号、资源和输入摘要；Models 保留共享验证额度与演示安装协调。stdio MCP 由 Mac worker 使用本机显式登记的完整命令与参数执行，环境键需另行登记，不继承个人 HOME、PATH 或工作目录。执行前持久化意图，回复丢失只重交付原回执；中断结果未知时不重新派发。Skills 文件按本服务已提交的记录恢复。未知验证的公开核对入口仍待完成，不能据此认定全部恢复能力已交付。

Thought 的自有 schema、账号目录、受限写作模型端口、素材元数据和 Markdown/HTML 导出字节端口已经隔离；恢复网站显式注入旧适配器。修改与模板复用在写事务前预取素材快照，失败或过期拒绝写入。飞书同步继续通过用户显式同步请求调用已有外部连接，图片读取使用同一素材端口。独立 Thought 现提供 93 项已登记公开操作和浏览器入口，引用准备、上传与归档回执均可恢复。

真实九容器与 Chromium 验收 `fpl-isolated-agents-e308095503` 的 17 项综合检查通过：Models 页面、HTTP/SSE、实时语音撤权、原生安装与语音、Models 重启后重复回存只执行一次；Integrations 的真实 stdio 发现、共享额度结算、独立重启与 Skills 字节持久化；以及既有账号、工作台、素材、渲染、门户停止后的新登录和程序版本隔离。Models 三页与 Integrations 四页覆盖 390／768／1600px、明暗主题，手机聊天区填满可用宽度。依赖镜像在真实容器中执行导入检查，避免本机依赖掩盖漏包。

全部数据为隔离生成的账号、文件、媒体和模型合成实现，容器已回收；真实供应商与 Qwen/MLX 权重没有调用。正式网站、配置及数据库未切换。其余服务和正式数据转移仍按上面的切换门禁推进，当前源码不能直接安装接管正式数据。


### 验证核对与工坊边界准备

集成中心现在可以查看当前账号待核对的验证并检查原回执；只有确认未派发或原生任务具有匹配的持久终态证据时，才结算原额度。远端结果仍未知时继续保留额度，不以超时或用户声明代替终止证据。新增公开接口、分页、SDK 和官方使用指南已同步。

Creative 已具备三张自有表、独立迁移、公开读取与账号写入保护、显式作者／来源／归档／安装端口及独立浏览器构建。上传使用 CAS，提交结果未知时保留可能已登记的文件；旧站显式装配原有适配。Integrations 目标端已具备固定批次、Skill 校验与幂等安装回执的隔离用例，但生产 HTTP、Creative 侧持久协调和可信原始请求体绑定尚未接入。创意工坊的来源 ID 不能仅凭原始请求路径授权，完整服务仍不得部署。

Thought 已具备引用准备与结果 outbox，笔记和模板更新／删除的来源授权绑定具体资源 ID，其他来源默认拒绝；模板创建等无法可信绑定目标的操作继续关闭。社区单素材私有读取在 Assets 每次访问时重新核对 Identity Session 与 Thought 的当前发布、文章权限、正文／多维表引用和资源版本。这些 Thought 边界随后通过独立 HTTP 和启动装配接通。

最新隔离九容器与浏览器运行 `fpl-isolated-agents-b2069b57b3` 的 17 项综合检查通过；其中集成接口额外检查了分页响应、非法 ID 和不存在的核对记录。Thought 社区与 Creative 目标安装本批使用独立数据库及真实 ASGI 私有协议测试，尚未纳入完整服务容器验收。正式数据未切换。

### Thought 独立部署

构建页面后，把命令返回的浏览器版本目录传给镜像构建。

```sh
npm run services:build:web -- thought
npm run services:build -- thought --web-release .local/service-web/thought/BUILD_ID --build
```

`FPL_THOUGHT_IMAGE` 显式选择叠加清单。配置 `FPL_THOUGHT_STATE`、`FPL_THOUGHT_CONFIG`、`FPL_THOUGHT_IDENTITY_CLIENT` 和 `FPL_THOUGHT_ASSETS_PEER`。Identity 登记 Thought 专属连接凭据。Thought 与 Assets 只读挂载同一对等配置文件，其中 `community` 与 `upload_receipt` 使用分别生成的独立凭据。Thought TOML 只读取所属 SQLite 路径及备份、上传容量限制。镜像要求 `migrate` 显式执行，启动会核验数据库历史和浏览器契约。Models 和 Integrations 通过固定接口提供写作和外部同步。

隔离验收命令使用专用项目、合成账号和独立卷。指定本机 Chromium 可覆盖浏览器版本缓存缺失的情况。

```sh
uv run python scripts/website/service_docker_smoke.py \
  --image fpl/identity:VERSION --gateway-image fpl/gateway:VERSION \
  --assets-image fpl/assets:VERSION --thought-image fpl/thought:VERSION \
  --local-port 19442 --public-port 19443 --browser-check
```


### Creative 作品认证

Creative 已注册 16 项公开操作。作品认证通过 Identity 的签名命令交给 Visual 或 Galgame 更新自有项目和版本。所属服务将审计待投递状态与项目一同提交，确认丢失后可重放，Identity 按原命令去重并签发审计收据。隔离 HTTP 验证了两种项目、原账号归属、并发版本冲突、撤权及重启恢复。Visual 与 Galgame 的完整公开路由、浏览器程序和生产就绪检查仍是整站联调的前置门禁。


Visual 与 Galgame 的认证和公开项目目录可用安装后的进程验收。分别构建镜像，并在合成账号和独立卷的环境中加载 `deploy/project-owners.compose.yaml`，与 Creative、Integrations 和基础清单一起启动。

```sh
npm run services:build -- visual --build
npm run services:build -- galgame --build
```

为两套服务分别选择 `FPL_VISUAL_IMAGE` 和 `FPL_GALGAME_IMAGE`，设置专用 `FPL_VISUAL_STATE`、`FPL_GALGAME_STATE` 和同名服务的 `_IDENTITY_TOKEN` 文件。Identity 登记不同的凭据。对每套新隔离卷先执行 Compose 的 `run --rm --no-deps SERVICE migrate`。容器探针检查存活，应用的 `/ready` 保留完整编辑与部署门禁。

隔离运行 `fpl-project-owners-958ca2aaf6` 使用六个安装镜像，通过 Gateway 创建、认证并读回两种项目，重复旧版本认证返回 409。Creative 的 stdio、Skill 归档和安装重放及 Chromium 的登录态入口通过。停止隔离容器并恢复同版本服务快照后，登录、Skill 文件内容、安装回执及两种认证标记均可读回。这项验证使用合成数据，历史迁移与旧站恢复分别由正式演练门禁跟踪。

Galgame 的新项目创建和公开 Story 保存需要同一私网中的 Identity 与 Assets。对旧数据，迁移必须为每条 Story 预先构建匹配版本的素材投影，再核验当前与历史文件归属。未建立投影时，保存会提示素材引用状态未核验。

隔离运行 `fpl-galgame-story-5bc33bf854` 在上述认证链路加装 Assets。经网关上传 PNG、保存故事、拒绝旧版本写入并下载原文件。恢复同版本隔离快照后，Story 版本为 1，下载文件 SHA256 为 `60660146a85c7cdfadc827f774e968bce1b63c1b68aa42c40d435c1e7f379cf9`。这是新服务自身的恢复验收，正式历史迁移和旧站回滚演练仍待完成。

隔离运行 `fpl-galgame-operations-6698b8bf25` 额外验证了 Story 操作批次。相同请求在正常执行后和快照恢复后都返回原版本，同一请求 ID 改用不同正文返回 409。

隔离运行 `fpl-visual-canvas-11f5f07889` 在同一七服务链路验证 Visual 画布。未放置的文件被拒绝，关联后可保存，移除原放置后再保存仍保留同一输出 ID。恢复隔离快照后读回相同画布版本、节点输出和素材字节。Visual 的新项目创建和画布保存依赖同一私网的 Identity 与 Assets。

隔离运行 `fpl-visual-operations-4dffc38f1e` 验证了画布操作批次和恢复后的重放。相同请求返回原画布版本与输出 ID，不同请求复用同一请求 ID 时返回 409。

隔离运行 `fpl-visual-outputs-00df9bfc63` 验证了节点输出的分页、详情和恢复后同一版本读回。


### Tools 导航状态

`npm run services:build -- tools --build` 构建 Tools 镜像。`deploy/tools.compose.yaml` 使用独立的 `FPL_TOOLS_STATE` 与只读 Identity 公钥。隔离运行 `fpl-tools-owner-8f178e9894` 经 Gateway 验证了收藏、使用计数及容器重启后的持久化。历史迁移及正式编排仍纳入 Tools 完整就绪门禁。

构建浏览器程序可运行 `npm run services:build:web -- tools`，再把返回目录作为 `--web-release` 传给镜像构建。隔离运行 `fpl-tools-browser-71a1b5d024` 验证了 Chromium 登录态收藏、工具目录手机宽度、两条深链接及旧程序版本写入拒绝，也检查了公网监听的页面与未登录 API 响应。

本机文件库打开可额外加载 `deploy/tools-native.compose.yaml`。隔离环境为 Tools、Identity 与原生入口分别设置用途限定凭据，Gateway 的独立回环监听登记 Tools 原生通道。Mac worker 由 `uv run python -m fpl_host.tools_worker` 启动，使用明确指定的回环桥接地址、独占凭据文件、Assets 状态根目录和自有回执目录。容器只接收任务与回执。公网及 Management API Key 无权打开本机目录。

隔离运行 `fpl-tools-native-245d307d35` 通过真实回环入口、签名账号会话和 Mac worker 逻辑完成目录请求。测试适配器记录了唯一的 Finder 启动参数，验证路径归属并拒绝浏览器访问原生入口。自动化用例另验证回执丢失后的恢复、过期未领取任务和公网管理员限制。

隔离运行 `fpl-tools-dependencies-7fa491262d` 经真实回环通道读取固定视频工具的测试状态。API 单测核对了本机响应中的路径与公网响应中的路径隐藏。下载任务的执行、文件交付和入库回执在后续批次接入。

隔离运行 `fpl-tools-video-38e992255f` 使用真实四容器和原生回环传输，并用合成下载器替代外部供应商。任务只执行一次，网页下载与 Assets 入库读回相同字节，Tools 重启后仍可查询任务及下载。八项公开操作与发布契约一致。实际供应商下载与个人浏览器 Cookie 未用于验收。

### Tools 历史导航迁移

首条维护链路迁移历史收藏、使用次数和三个时间戳。使用合成数据或已经停写并完成 SQLite WAL 检查点的独立快照。源快照保持只读。目标必须为已通过同版本显式 `migrate` 初始化、且没有运行 Tools 应用的隔离状态目录。

迁移计划是 0600 的 JSON 文件，保存本次的 `run_id`、旧站提交 `source_revision`、源数据库摘要 `source_database_sha256`、已核对的账号 UUID 清单 `owner_ids` 和单次迁移专用随机 `token`。账号清单须来自已核验的 Identity 数据。分开启动两个维护进程，再运行传输程序。

```sh
uv run python -m fpl_tools migration-export --migration-plan "$plan" \
  --legacy-db "$snapshot/future-props.db" --port 19561
uv run python -m fpl_tools migration-import --migration-plan "$plan" \
  --state-root "$tools_state" --port 19562
uv run python -m scripts.website.migrate_tools_navigation --plan "$plan" \
  --source http://127.0.0.1:19561 --target http://127.0.0.1:19562
```

维护进程只监听回环，拒绝浏览器 Origin。传输以账号和工具键分页，每批最多 256 条。记录与回执同事务提交。连接中断后以同一计划和地址重跑，完全相同的批次返回原回执。账号缺失、批次摘要变化、记录重叠或源快照变化会终止传输。最后逐账号读回目标数据并核对分页摘要与总记录数。留存成功报告并停止两个维护进程。旧站回滚和其余数据集仍由整站演练门禁跟踪。

### Assets 历史文件夹和原件

使用已核验的账号计划，先导入父目录，再导入素材记录，最后传输原件。记录保留 ID、项目作用域、目录、版本和时间戳。原件按账号及记录推导路径，逐个核对长度和 SHA256。传输流通过临时文件落盘并原子发布。已提交的原件按摘要重放。未知原件、跨账号目录、父目录冲突或仍待恢复的项目删除暂存都会停止迁移。

```sh
uv run python -m fpl_assets migration-export --migration-plan "$plan" \
  --legacy-db "$snapshot/future-props.db" --port 19569
uv run python -m fpl_assets migration-import --migration-plan "$plan" \
  --state-root "$assets_state" --port 19570
uv run python -m scripts.website.migrate_assets --plan "$plan" \
  --source http://127.0.0.1:19569 --target http://127.0.0.1:19570
```

与当前文件摘要相同的旧版升级副本保留在完整回滚快照。项目链接和引用索引应在相应业务数据导入后重建并核验，仍由整站切换门禁跟踪。

### Identity 账号与凭据迁移

与 Tools 使用同一份源快照和迁移计划。Identity 的账号数据集核对计划中的全部账号 UUID，随后导入 Studio 会话、Management API Key、加密 TOTP 登记和会话解锁记录。保留密码摘要、原账号 ID、角色、凭据范围、过期与撤销状态。旧站的会话保持 Studio 用途。管理中台需要其专用会话。凭据摘要和加密 TOTP 记录只通过显式回环维护进程传输，报告只保存数据集计数与批次摘要。

```sh
uv run python -m fpl_identity migration-export --migration-plan "$plan" \
  --legacy-db "$snapshot/future-props.db" --port 19563
uv run python -m fpl_identity migration-import --migration-plan "$plan" \
  --state-root "$identity_state" --port 19564
uv run python -m scripts.website.migrate_identity --plan "$plan" \
  --source http://127.0.0.1:19563 --target http://127.0.0.1:19564
```

目标先按同版本显式初始化 schema，且处于停止状态。导入会拒绝缺少账号、账号冲突或摘要变化。隔离验收经独立 Identity 登录及授权入口验证原 Studio 会话、原管理密钥、已撤销密钥与另一账号密码。TOTP 验证保留原加密密钥和已使用验证码计数，解锁记录必须对应同一账号的已导入会话。邀请码与安全审计使用迁移运行的独立分区，保留已删除邀请码、原加密密钥下可读取的密文、核销历史以及无账号的失败事件。核销记录按原账号导入，核对每份邀请码的累计核销次数。Models 目录在账号迁移后单独处理。只有所有数据集、文件与跨服务关系校验通过后才能恢复网站写入。

Identity 传输工具随后核验并迁移同一快照中 `profiles/` 下的账号原头像。每个文件的账号路径、媒体类型和 SHA256 必须与账号记录一致。未登记的原件、符号链接、缺失或摘要不符都会停止验收。目标在写入同目录树内的私有暂存后，原子发布原件并同步目录。重放核对已存在文件的字节，再返回同一结果。暂存文件保留在快照中，生成的预览由账号资料入口按需重建。

### Director 独立运行

先运行 `npm run services:build:web -- director`，把返回目录作为 `--web-release` 传给 `npm run services:build -- director --build`。叠加 `deploy/director.compose.yaml` 并配置 `FPL_DIRECTOR_IMAGE`、`FPL_DIRECTOR_STATE` 和 Identity 公钥。在隔离空卷上显式运行 `director migrate` 后启动。Director 自己持有项目、动作库、文件和编辑器会话。服务重启后，浏览器重新建立编辑会话。

三容器验收 `fpl-director-browser-65f3dcb78d` 验证了 390px 项目列表、WebGL 编辑器深链接和初始化保存、旧程序版本写入拒绝、回环公网监听的匿名保护，以及 Director 容器重启后原文件读回。浏览器版本为 `c6ba2149dd0e285ed7bc`，镜像为 `fpl/director:f4c0e8bde89255b83a46`。导演台项目和动作文件已有隔离迁移验收，服务保留正式历史数据和整站就绪门禁。

### Models 历史目录与凭据

目录按供应商分组、供应商、模型和账号目录修订的顺序导入。每个模型只能指向已导入的本账号供应商。保持原 ID、版本、能力配置和密文。目标维护进程用原配置的加密密钥验证每份供应商密文，错误密钥会阻止导入。维护配置由当前用户独占，包含目标数据库绝对路径及原密钥。

```sh
uv run python -m fpl_models migration-export --migration-plan "$plan" \
  --legacy-db "$snapshot/future-props.db" --port 19571
uv run python -m fpl_models migration-import --migration-plan "$plan" \
  --state-root "$models_state" --config "$models_config" --port 19572
uv run python -m scripts.website.migrate_model_catalog --plan "$plan" \
  --source http://127.0.0.1:19571 --target http://127.0.0.1:19572
```

隔离演练保留了来源供应商关系和密文，验证原回执及错误密钥拒绝，并从恢复后的旧站读回同一份目录。账号默认模型在目录之后导入，按账号校验模型 ID。角色模板、运行额度和演示配置使用迁移运行的独立分区，保留修订和时间戳，验证模板密文可用。调用及任务历史、原件和索引仍需独立核验。

### 封存来源覆盖检查

用 `uv run python -m scripts.website.migration_coverage --snapshot "$sealed_snapshot" --manifest-sha256 "$manifest_sha256" --plan "$plan"` 核对来源实际表和已登记的数据集。报告只列表、归属、分区和记录数。有记录的未迁移表、未归属表和待重建索引会以退出码 2 阻止通过。来源覆盖仍需和目标导入回执、文件摘要及旧站恢复结果一起验收。

### Director 历史项目与文件

复用已封存快照和 Identity 确认过的账号计划。项目文档、修订号、动作和历史时间戳经回环维护接口迁移。每条记录独立分页，单条请求超过 32 MiB 会停止迁移。文件按账号以及项目或动作库分区传输，单文件上限与导演台日常上传一致。SHA256 校验通过后原子发布，再持久记录回执。相同文件重放时核对磁盘字节。未登记账号、项目引用缺失、额外目标文件、摘要不符或仍待恢复的删除暂存都会阻止验收。

```sh
uv run python -m fpl_director migration-export --migration-plan "$plan" \
  --legacy-db "$snapshot/future-props.db" --port 19567
uv run python -m fpl_director migration-import --migration-plan "$plan" \
  --state-root "$director_state" --port 19568
uv run python -m scripts.website.migrate_director --plan "$plan" \
  --source http://127.0.0.1:19567 --target http://127.0.0.1:19568
```

隔离快照演练从旧站 API 写入项目、动作和超过 2 MiB 的项目文件，验证损坏上传失败、原批次重放、源目标文件清单一致，并从回滚后的旧站读回项目修订号及两份原件。

### 主线云控与执行契约

主线 `5f16f360` 新增的云控浏览页面仍由 Portal 提供。TOTP 与解锁凭据归 Identity，桌面状态、连接和 WebSocket 归已登记的 Remote 能力，工作台聊天与执行归 Agents。编程智能体目录、检测和本机启用归 Agent Runtime。归属清单现在同时登记页面根和各 TOML 字段的所有者。旧 `/remote` 占位页已从清单撤去，保留正式 `/cloud-control` 入口。

合并后的兼容应用继续执行云控权限、可信入口、密码重验和已配置的桌面或项目限制。独立 Remote 已装配桌面连接，Identity 已装配加密 TOTP 迁移。Agents 原生执行和配置投影仍需接线和隔离验证。Identity 已签发仅用于 Remote WebSocket 的票据 SHA256 并提供限定用途的实时云控授权复核。独立 Identity 已装配 TOTP 验证与自有 schema。Agents 已装配自有聊天记录、SSE 和重启恢复；新执行与审批写入仍由独立服务就绪门禁拦截。独立网关继续移除业务上游请求中的浏览器 Cookie，桌面专用凭据须单独限定用途与目标。

### Agent Runtime 独立连接目录

运行 `npm run services:build:web -- agent-runtime`，用返回的 `--web-release` 构建 Agent Runtime 镜像。叠加 `deploy/agent-runtime.compose.yaml` 并配置自有状态目录、Identity 公钥和私有原生配置。Gateway 的回环原生入口使用单独 Agent Runtime 通道凭据，Identity 登记不同的服务凭据。容器只持有原生任务及回执。

Mac worker 从 `uv run python -m fpl_host.agent_connections_worker` 启动，显式传入专用回环 `--bridge`、当前用户独占的 `--worker-token`、`--state-root` 及部署 `--config`。编程智能体目录、重新检测和启用沿用发布契约。本机管理员近期密码验证后可启用已安装及已登录的连接。写入前再次检查原会话，回执丢失后重放原结果。公开访问看不到可执行文件路径，也不能启用 CLI。项目和对话的原生执行能力仍是正式就绪门禁。

三容器运行 `fpl-agent-runtime-browser-64ccdf16ce` 验证了 Mac 回环、隔离 TOML 写入和 Chromium 390px 浏览器启用流程。模拟 CLI 返回固定版本与模型，无须真实供应商凭据。定向测试覆盖公网路径遮蔽、写入前撤权及丢失回执后的恢复。

### Amadeus 记录服务

运行 `npm run services:build -- amadeus --build` 并加载 `deploy/amadeus.compose.yaml`，为 Amadeus 提供独立状态目录、Identity 公钥和专属凭据。先显式执行 0001 迁移。三容器隔离运行 `fpl-amadeus-records-df66597c64` 验证网关账号鉴权、会话修订、旧模型协议的 410 响应和重启后的记录读回。当前装配包含 19 项公开记录或兼容操作，工作文件、工具和 Mac CLI 接线仍需通过就绪检查。

### 旧站快照及恢复目录演练

恢复包包含停机网站的完整 `.runtime/` 运行树、原始 `backend/config.toml` 和逐文件清单。清单覆盖目录及权限、内部相对链接、文件大小和 SHA256、配置摘要与 SQLite 迁移顺序。数据库检查使用只读连接并逐条核对注册表 checksum。运行锁未释放、数据库仍打开、WAL 未结算、外部链接、文件变化或版本不符都会阻止发布恢复包。

在独立验收目录和对应旧站提交下运行下列命令。所有输出目录必须预先选择为空路径，父目录已存在。

```sh
uv run python -m scripts.website.legacy_snapshot create \
  --runtime "$source_runtime" --config "$source_config" \
  --output "$sealed_snapshot" --source-revision "$source_git_sha"
uv run python -m scripts.website.legacy_snapshot restore \
  --snapshot "$sealed_snapshot" --target "$recovery_bundle" \
  --source-revision "$source_git_sha" --manifest-sha256 "$manifest_sha256"
```

隔离恢复以原配置为凭据来源，另建启动投影，仅调整隔离数据库路径和监听端口并关闭公网。使用旧站同一启动器读回登录态、账号、工具记录、头像原件与桌面空闲偏好。验证链路还将同一快照经回环维护接口导入 Identity、Tools 与 Remote，重复提交核对原回执，再从原快照启动旧站。正式演练还需覆盖其余数据集、已发布网页、跨服务关系、网关凭据与公网恢复。

### Remote 桌面连接

运行 `npm run services:build -- remote --build` 并加载 `deploy/remote.compose.yaml`，为 Remote 指定专用卷、Identity 公钥、服务凭据和只读传输配置。网关只把签名上下文转交 Remote。连接票据仅能使用一次，绑定账号、会话、可信入口与当前 TOTP 登记代。撤销会话或重设验证器会阻止旧连接继续传输。

Remote 设置需要 0003 迁移及 `deploy/remote-settings.compose.yaml`。用独立原生凭据注册 Gateway 的 `remote` 回环通道。启动 Mac worker 时显式提供专用状态目录、原生 worker 凭据、权威部署 TOML 和预先创建的投影根目录。

```sh
uv run python -m fpl_host.cloud_setup_worker \
  --bridge "http://127.0.0.1:$native_port/remote" --worker-token "$remote_worker_token" \
  --state-root "$remote_worker_state" --config "$deployment_config" \
  --projections "$cloud_projection_root"
```

worker 将根目录下的 `identity`、`remote`、`committed` 分别供 Compose 挂载。只读投影与原配置写入均由 Mac 协调。Remote 就绪需要可读的已提交版本和在轮询的 worker。隔离测试使用合成 Guacamole 对端及隔离账号。正式 Mac 屏幕共享和数据验收由整站切换门禁核验。

Guacamole 伴随进程使用 `deploy/remote-guacd.compose.yaml`。将已验收且已导入本机的带 Mac 认证适配镜像摘要指定为 `FPL_GUACD_IMAGE`。该进程仅在私网接受 Remote 请求，VNC 目标仍由部署配置预设。Remote 就绪检查同时探测实际 Guacamole TCP 对端。

隔离运行 `fpl-remote-native-0b53131db1` 使用真实 Guacamole 与受密码保护的 RFB 夹具，经 Chromium 验证云控设置、画面传输、390px 页面及 Remote／Identity 重启后的设置读回。验收镜像为 `mac-browser-remote-guacd@sha256:a7445df8bcabb9f3d19164f71baac96b0e859cdd36b1bc8f3a62df64a63c87aa`。

四容器运行 `fpl-remote-protocol-95f841c9ca` 经真实 Gateway 建立桌面 WebSocket，验证了单次票据、注销后关流及 Remote 重启后偏好读回。镜像 `fpl/remote:09ba3729bd9555e58b81` 包含独立锁定的 WebSocket 依赖。Guacamole TCP 对端使用合成协议夹具。

历史桌面空闲偏好使用同一份已封存源和迁移计划，目标为已初始化且停止运行的 Remote 状态目录。

```sh
uv run python -m fpl_remote migration-export --migration-plan "$plan" \
  --legacy-db "$snapshot/future-props.db" --port 19565
uv run python -m fpl_remote migration-import --migration-plan "$plan" \
  --state-root "$remote_state" --port 19566
uv run python -m scripts.website.migrate_remote_preferences --plan "$plan" \
  --source http://127.0.0.1:19565 --target http://127.0.0.1:19566
```

维护入口按账号核对分钟数、修订号、记录数量和摘要。记录与回执同事务提交，重复提交返回同一回执。隔离演练在旧站写入偏好，迁移、重放并从封存快照启动旧站后再核对修订号。


### Interview 独立运行

运行 `npm run services:build:web -- interview`，将产物目录通过 `--web-release` 传给 Interview 镜像构建。叠加 `deploy/interview.compose.yaml`，配置独立状态目录和 Identity 公钥。显式运行 `interview migrate` 后启动。Gateway 使用已登记的 `/apps/interview-assistant` 页面和 12 项发布 API。场次、原始材料、请求回执和准备历史由 Interview 持有。进程启动时把未完成的旧任务标记为中断，用户可重新提交。

隔离运行 `fpl-interview-browser-11cf956d81` 通过 Gateway、Identity 和 Interview 验证登录、材料上传下载、旧浏览器版本拒绝、回环公网入口、容器重启和 390/768/1440px Chromium 界面。浏览器版本为 `3c3351e4400104946723`，Interview 镜像为 `fpl/interview:2f0792d1f1351f07fbc6`。历史数据迁移和真实 Codex 连接仍由正式就绪门禁跟踪。

启用执行时叠加 `deploy/interview-native.compose.yaml`。为 Gateway 的 Interview 原生回环入口、Identity 用途限定访问和每个 Mac worker 分别生成凭据。容器读取专用的 `FPL_INTERVIEW_NATIVE_OPTIONS`。Mac worker 用 `uv run python -m fpl_host.interview_worker` 启动，参数为 `--bridge`、`--worker-token`、`--state-root` 和 `--config`。回环地址须包含 `/interview`，凭据和配置须由当前用户独占。

任务只向 worker 交付对应场次的冻结输入和原件。运行时复核账号权限并持续检查租约。重复回执复用已入库的交付。重启、超时、权限撤销和输入版本变化会终止旧任务或阻止其发布。真实供应商凭据和任务材料保持在隔离执行边界内。

隔离运行 `fpl-interview-native-aa2b9b3b06` 使用镜像 `fpl/gateway:0d91b963d4902f76670d`、`fpl/identity:4b5009a0cc269e124498` 和 `fpl/interview:57314b3064824bae0946`。Mac 侧合成执行器通过真实 Gateway 领取原件，提交按规则标记为待补充的交付，随后经公开接口读取进度和导出。浏览器来源访问原生领取入口返回 403。


### Annotation 素材边界

音频标注由原业务请求向 Identity 换取专用素材读取授权。项目列表只授权元数据。创建、导入和片段读取可访问当前账号、已核对修订的原件。项目创建时 Assets 为一份音频准备引用，准备和提交后的引用均阻止文件删除。只有绑定同一项目的删除请求可以释放引用。定向测试使用真实 Identity 和 Assets 验证跨账号、修改查询、版本冲突及删除保护。音频标注独立项目和浏览器入口已装配。正式历史数据仍在切换门禁内。

音频标注使用 `deploy/annotation.compose.yaml`，指定独立状态卷、Identity 公钥和用途限定服务凭据。运行 `npm run services:build:web -- annotation`，把同版本浏览器产物通过 `--web-release` 交给镜像构建。显式运行 `annotation migrate` 后启动。

四容器验收 `fpl-annotation-browser-82e8e87543` 通过 Gateway 上传 WAV、创建和裁切项目，经 Chromium 打开 390px 列表和 390/768/1440px 编辑器。它验证了旧浏览器版本写入拒绝、回环公网入口和重启后读回。镜像为 `fpl/annotation:9632cf95d6c15b1d1403`，浏览器版本为 `c525658288fdb4b436d3`。

上传片段和已保存片段均由 Models 使用自己的模型目录、供应商凭据和调用日志执行。Annotation 校验项目和时间范围，Identity 签名绑定输入元数据及 WAV 摘要，Models 复核授权后才提交供应商。相同尝试返回原回执，未确认的旧尝试不会再次发起。定向联调使用确定性供应商夹具验证两条入口和回执，真实供应商验收仍由正式门禁跟踪。

已完成的 Models 任务可以导入音频标注。原音频仍在账号库时沿用该素材。需要复制时，先校验音频时长和识别结果，再经 Assets 保存原件及持久回执。重复导入可创建独立标注项目，原件按任务和摘要复用。若项目写入中断，已保存原件会留在账号库供同任务恢复使用。


### Presentation 文稿边界

独立镜像装配文稿列表、新建、读取、CAS 保存、删除和编辑批次六项发布操作。叠加 `deploy/presentation.compose.yaml`，提供独立状态目录、Identity 公钥和 Presentation 服务凭据，显式执行 `presentation migrate` 后启动。启动比对已装配的公开操作及其 schema。

编辑时 Identity 对素材查询摘要和指定版本的 SVG 原件签发限定授权。Assets 只允许访问同一账号的普通文件库。素材先由 Assets 准备保留，文稿及结果在同一事务提交，后台使用持久回执交付确认。隔离运行证据按文稿、模板、导入导出、浏览器和历史迁移分别记录。

四容器隔离验收 `fpl-presentation-api-8a59c2ddbf` 通过 Gateway 验证 SVG 上传与规范化摘要、文稿保存、素材删除保护、容器重启、原编辑回执重放、删除后的素材释放以及回环公网入口的认证。该批次使用 API 镜像 `fpl/presentation:643627c8951ef323c5b1`。

模板和示例库增加 15 项独立操作。组合导入将模板、示例和两份素材引用结果放在同一事务。模板应用在素材准备完成后，通过源事务再次核对模板修订。隔离测试验证组合中第二项失败时不保留第一项记录，以及并发模板更新阻止旧预览落库。

演示工坊还装配导出预览、JSON、原生文稿包和 PPTX。包含素材的导出通过专用签名读取固定版本，在独立状态目录暂存有界输入。测试核对原生文稿包中 SVG 的规范化原件、PPTX 页面和媒体、旧修订拒绝及暂存清理。

四容器隔离验收 `fpl-presentation-export-f3a7f54fbf` 使用 `fpl/presentation:deec05c2517707b523ae`，经真实 Gateway 下载原生包和 PPTX，核对规范化 SVG 摘要及 PPTX 页面和媒体。

运行 `npm run services:build:web -- presentation`，将产物通过 `--web-release` 封装到演示工坊镜像。列表、文稿画布、模板库、模板设计器和演示入口沿用原 URL。四容器隔离验收 `fpl-presentation-browser-0045ccb84e` 验证浏览器版本 `0cb23c1a148a6ca275e0`、390/768/1440px 布局、模板保存、旧浏览器版本拒绝及回环公网模板入口。

演示工坊的 26 项发布操作均已装配。部署叠加文件为 Presentation 与 Assets 挂载同一份独立的 `FPL_PRESENTATION_ARCHIVE_KEY`。PPTX 和原生包嵌入素材先私有暂存，源事务提交决议后才发布，收到准确回执后才开放项目。已拥有的素材引用在封存时受保护。JSON 文稿沿用现有素材及普通文稿引用事务。历史迁移和全站切换继续使用独立门禁。

隔离运行 `fpl-presentation-import-f141f81f9a` 用镜像 `fpl/presentation:4b3faf0faa941f0a81a7` 通过四容器及 Chromium，覆盖原生包和 JSON 往返、复制素材 SHA256、编辑回执、模板保存、旧浏览器版本拒绝及回环公网入口。


演示工坊的历史转移先导入同一计划下的 Assets 元数据和文件。随后启动独立回环 `presentation migration-export`、`presentation migration-import` 与 `assets migration-import`，使用 `uv run python -m scripts.website.migrate_presentation --plan <计划> --source <旧站快照维护地址> --target <Presentation 维护地址> --assets-target <Assets 维护地址>`。源仅打开封存的只读快照。迁移保存原始文档 JSON、标识、版本、时间戳与编辑回执，按三类资源重建并读回素材引用。关系导入要求同一轮原件 SHA256 回执，源引用不一致、缺失文件、账号越界或回执冲突会阻止核验。

隔离旧站快照演练使用普通业务 API 建立原文稿、模板、示例、原件和含 Unicode 请求标识的编辑回执。导入和重放核对源与目的摘要，验证 Assets 维护进程重启后续跑，恢复旧站后核对原文稿修订及文件字节。


### Motion 文稿边界

特效制作工坊独立镜像承接项目列表、新建、读取、重命名、文稿和编辑批次六项操作。使用 `deploy/motion.compose.yaml`、专属状态目录和 Identity 凭据，显式执行 `motion migrate` 后启动。编辑素材只能通过签名请求读取同一账号、同一特效项目下的文件描述，文稿修订和编辑回执同事务提交。项目删除、文件、渲染和视频交接继续由生产就绪门禁跟踪。

隔离运行 `fpl-motion-api-4ff09339f8` 使用镜像 `fpl/motion:5a541d36b4ec4d87ff3c`，经四容器 Gateway 验证旧修订拒绝、原回执重放、非本项目素材拒绝和回环公网认证。

特效制作工坊的五项素材操作也经独立接线。上传绑定原件大小和 SHA256，复制绑定源文件集合，Assets 将文件记录和回执一起提交。隔离运行 `fpl-motion-media-9847b25f1d` 使用 `fpl/motion:2b4f4592fa8a6f4469e8`，经四容器验证上传、复制、206 分段下载、完整字节和文稿引用。

特效项目删除先对项目文件写入加栅栏，再以项目修订删除文稿及回执。Assets 收到持久删除结果后才删除项目文件记录并排队清理原件。测试注入并发上传和结算回执丢失。隔离运行 `fpl-motion-delete-432fa9328a` 验证了真实 Gateway 删除及账号库原件保留。

精确帧由独立 Rendering 生成。Motion 提交固定修订的文稿和当前帧素材版本，Assets 核验同账号同项目后按固定顺序流式传输原件。Rendering 完成前再次核验账号权限。五容器隔离运行 `fpl-motion-preview-7ecfac220d` 验证 PNG 原件像素、MP4 取帧、旧修订拒绝及项目删除后的原件保护。

运行 `npm run services:build:web -- motion`，将产物通过 `--web-release` 封装到特效工坊镜像。五容器 Chromium 验收 `fpl-motion-browser-604205eb1f` 使用浏览器版本 `536c7b557a235e5c145d`，验证 390/768/1440px、精确帧、编辑保存、回环公网入口及旧版本写入拒绝。工程包和导出任务仍由就绪门禁跟踪。

特效工程包导入导出保留原 ZIP 清单。导出逐项核对文件版本和字节，生成后复查账号权限。导入由 `FPL_MOTION_ARCHIVE_KEY` 绑定 Motion 和 Assets 的专用归档通道。素材私有暂存，收到源决议才发布。Motion 在收到确认后一起写入项目、文稿和导入编辑回执。隔离运行 `fpl-motion-archive-e85ef214a3` 验证了 PNG、MP4 归档、文件 ID 重映射、原始和导入项目的精确帧逐字节相同，以及 Chromium 保存。

五项导出操作通过 Motion 的持久投递连接 Rendering。部署叠加 `deploy/motion.compose.yaml` 时，将独立的 `FPL_MOTION_EXPORT_KEY` 只读挂载到两者，分别运行 `motion migrate` 和 `rendering migrate`。Rendering 持有冻结输入和成片。Motion 依据原请求 ID 返回同一任务，项目删除后继续送达远端清理。五容器隔离运行 `fpl-motion-exports-dd5ac218be` 验证任务提交后的双服务重启、MP4、ProRes 4444、透明 PNG 序列、精确帧字节一致和 206 下载，也复跑 Chromium 编辑及工程包。定向测试注入丢失提交回执和渲染中断，覆盖账号隔离、取消和授权撤销。历史任务及视频剪辑交接仍由切换门禁跟踪。

### 视频剪辑项目

使用 `deploy/video.compose.yaml`、`FPL_VIDEO_STATE` 和 Identity 公钥，显式运行 `video migrate` 后启动。独立镜像 `fpl/video:7814b83e8fce9b4dda89` 在三容器隔离运行 `fpl-video-api-aabb86662d` 经 Gateway 验证项目创建、默认时间轴、修订冲突、重启后记录和回环公网鉴权。此批装配五项读写操作。时间轴编辑、素材、任务、剪辑交接、浏览器和历史迁移继续由就绪门禁跟踪。

时间轴操作现由独立 Video Editor 处理。部署时额外配置只读 `FPL_VIDEO_IDENTITY_TOKEN`，并在 Identity 登记 Video 的专用服务凭据。Video 在提交时间轴 CAS 前，通过签名范围向 Assets 查验确切项目和文件 ID 集合，再使用自有媒体状态验证轨道、类型和源区间。四容器运行 `fpl-video-timeline-8ba3d11c5c` 使用 `fpl/video:772d4c348dcb0eeb1152`，验证素材范围拒绝、保存、重放、过期修订和重启。

视频剪辑项目创建与删除通过持久范围回执连接 Assets。删除准备期间拒绝该项目的原件写入，源项目事务与回执一起提交，结算只清理匹配账号和项目的文件。运行 `fpl-video-layout-419ce2edc9` 经四容器验证了创建、旧修订拒绝、删除后 404 与时间轴重启。故障注入覆盖远端确认中断后保留栅栏及重新结算。

剪辑素材目录、原件上传与复制接入独立 Assets。Video 先持久登记请求，再通过绑定原件摘要或源文件集合的授权调用 Assets。Assets 同时提交原件和回执。Video 收到回执后登记素材元数据和一项处理任务，未知结果可在重启后按原路径查询。四容器运行 `fpl-video-files-8e4daa17a5` 使用 `fpl/video:39e5742f198c9f5aafcd`，验证上传、复制、时间轴引用、重启和删除后保留账号库原件。剪辑代理、音频波形和导出处理仍由就绪门禁跟踪。

剪辑代理、缩略图和波形由 Rendering 生成并持有。启用 `deploy/video.compose.yaml` 时，`FPL_VIDEO_MEDIA_KEY` 只挂载给 Video 和 Rendering，`FPL_VIDEO_ORIGINALS_KEY` 只挂载给 Rendering 和 Assets，两者使用独立凭据。部署时显式运行三者的迁移。Video 从同一任务回执恢复处理状态。预览派生文件经原有 URL 鉴权并支持 206 读取。五容器验收 `fpl-video-derivatives-6c8723c94b` 验证图片、音频、重启、重新生成和删除。隔离故障测试验证丢失入队响应后恢复原任务和跨账号拒绝。

运行 `npm run services:build:web -- video`，把返回的目录交给 `npm run services:build -- video --build --web-release`。独立程序包含原项目列表、任务列表和剪辑深链接。剪辑任务查询使用账号及项目归属，继续按渲染、分段和合并分类。五容器 Chromium 验收 `fpl-video-browser-99dadd330d` 使用浏览器版本 `656cd6bec9d069f15fc5`，验证 390/768/1440px、真实文字片段保存、任务页、回环公网入口和过期程序版本拒绝。渲染任务创建、工程包、成片交接和历史迁移继续由就绪门禁跟踪。

剪辑精确帧和文字图层经只读签名委托交给 Rendering。文稿修订、请求摘要及原件 revision 一起校验，转场帧读取两侧必要素材。PNG 返回前重新检查原授权。五容器运行 `fpl-video-frames-51f085e410` 复跑 Chromium 并验证文字图层、精确帧尺寸、缓存重放和旧修订拒绝。

独立成片保留原预检指纹、任务创建、状态、取消及下载地址。Video 提交冻结时间轴和原件 SHA256，Rendering 编码并核验 H.264、AAC、分辨率、帧率和时长。封存后按原输出摘要重试 Assets 入库，原件入库前再次核验账号权限。五容器 `fpl-video-export-0d00ac6caa` 验证 720p 成片、服务重启恢复、下载和 Chromium。故障用例注入 Assets 发布成功但丢失回执，恢复后复用同一文件。

Motion 的 MP4 与 ProRes 4444 可交接到同账号的现有或新建剪辑项目。Rendering 将相同原件字节写入目标 Assets 范围，Video 同事务登记原件、代理任务、顶层片段和交接回执。六容器 Chromium 运行 `fpl-motion-handoff-327535bf19` 验证两种格式逐字节一致，以及源项目删除后目标原件仍可用。隔离测试注入交接响应丢失，原请求按回执恢复。Motion 的 21 项发布操作已接线，历史转移与整站切换继续由就绪门禁跟踪。

音频相似接点分析复用原算法，经只读委托读取同一项目中相邻片段的同一原件。Rendering 核对源文件摘要和授权，返回原有候选及参考波形格式。五容器运行 `fpl-video-audio-66fb23759c` 使用合成音频验证重复分析结果、过期修订拒绝，并复跑 Chromium 和真实成片。

视频剪辑工程包沿用 `future-props-project-snapshot` 清单和项目 JSON。导出只包含项目原件及时间轴仍引用的成片，Assets 按原件修订传输。部署需将独立 `FPL_VIDEO_ARCHIVE_KEY` 只读挂载到 Video 和 Assets。导入核对 ZIP 与各原件摘要，Assets 确认后才发布副本并重映射时间轴。五容器 Chromium 运行 `fpl-video-snapshot-3f7566d8c1` 验证包内摘要和导入前后精确帧一致，隔离故障测试验证确认丢失时仅发布一次。

打开剪辑项目文件夹使用 Tools 原生回环入口，需同时加载 `deploy/tools.compose.yaml` 和 `deploy/tools-native.compose.yaml`，并将 Mac worker 指向同一 Assets 状态根目录。Video 先核验账号项目，Assets 只创建该项目的固定目录，再由 Tools 下发限时打开任务。五容器隔离运行 `fpl-video-reveal-860cb58a82` 验证本机浏览器 Session 与公网管理员拒绝。测试适配器记录了唯一的 Finder 启动参数，故障测试另核验丢失确认后只重发回执。

剪辑素材改名使用 Assets 的原件保留回执，剪辑默认效果与预期修订在 Video 提交。四容器 `fpl-video-media-edits-fb1afe1de2` 验证素材重命名、旧修订拒绝、服务重启后的状态和原件 SHA256。隔离故障测试分别验证准备和确认的响应丢失。

剪辑素材删除和已结束成片删除复用持久 Assets 结算。删除前核验时间轴引用和任务版本，成片按原发布回执绑定文件。五容器 Chromium 运行 `fpl-video-removal-c29c913081` 验证真实编码成片、任务和文件删除、旧版本拒绝及删除后派生文件不可访问。隔离测试验证删除与时间轴保存并发时不会提交失效素材引用。

剪辑片段合并使用已有 Video 与 Rendering 凭据及原件摘要链路。Rendering 校验 ProRes 4444 帧数、音轨和透明通道，派生代理与成片回执一起确认。五容器 Chromium 运行 `fpl-video-clip-merges-50d0cb484a` 验证真实编码、代理读取、同请求复用、应用合并、撤销和取消。

独立素材烘焙支持透明 PNG 与 1080p MP4，沿用 Video 到 Rendering 的持久任务与 Assets 原件发布凭据。五容器 Chromium 运行 `fpl-video-bake-a278ebf80c` 核对透明像素、视频规格、默认效果、重复提交、素材编排与双服务重启恢复。

分段任务可导出有序 MP4 批次并从原地址下载 ZIP。Rendering 核验封存规格，Assets 校验整组字节后原子发布，下载时重新比对每项 SHA256。五容器 Chromium 运行 `fpl-video-segments-5c805158cd` 验证真实编码、双服务重启、批次重放、取消、独立文件与 ZIP 条目一致以及 Range 下载。故障测试验证第二段摘要不符时整组不可见。

分段可交接到既有或新建 Visual 画布。叠加 `deploy/project-owners.compose.yaml`、`deploy/video.compose.yaml` 和 `deploy/video-visual-handoff.compose.yaml`，并分别提供 `FPL_VIDEO_SEGMENT_VISUAL_KEY` 和 `FPL_VISUAL_SEGMENT_ASSETS_KEY`。显式运行 Video、Assets、Visual 的迁移。待接收文件在目标确认前不可见。确认时核对画布修订，并登记文件库归属、画布节点与输出历史。隔离测试覆盖丢失确认、过期修订和分段传输失败。 六容器 Chromium 运行 `fpl-video-visual-handoff-94b5a2c569` 验证两种目标、ZIP 摘要、服务重启和源项目删除后目标原件仍可下载。

### 剪辑与特效历史记录

按既有 Assets 流程先传输记录与原件。Video、Motion 分别运行 `migration-export` 和 `migration-import`，使用同一受保护迁移计划、明确的快照及各自隔离目标目录。另外为 Rendering 显式执行迁移并启动 `migration-import`。将四个项目维护地址、两个 Assets 回环地址和 `--rendering-target` 传给 `uv run python -m scripts.website.migrate_editing_history`。命令先比对原件清单，再导入项目、文稿、编辑回执、素材元数据与任务记录，最后恢复匹配账号与原件集合的项目文件范围。缺失根项目、跨账号记录、文件摘要差异或记录重叠会阻止通过。

Rendering 逐文件恢复 Motion 成片及 Video 代理、缩略图和波形，原任务下载与预览 URL 保留。整组全部确认才登记历史渲染回执。源侧活跃的非媒体任务或无法归属的渲染文件会阻止通过。Assets 核对旧任务、账号范围和原件摘要，恢复成片删除及两种历史分段 ZIP 的原始关联。当前隔离验收在真实兼容站写入合成项目与素材，校验批次重放与 SHA256，再从封存快照恢复会话、原件和两个文稿。


Motion 与 Video 启动检查覆盖归属清单中的 21 和 38 项操作。七容器 Chromium 运行 `fpl-editing-ready-8cd7665342` 验证两项本地就绪探针、发布浏览器版本、真实成片与 Visual 交接。整站依赖、正式来源和维护窗口继续由全站切换门禁核验。

### 视觉创作工坊的浏览器版本与模型目录

用 `npm run services:build:web -- visual` 构建项目、画布、素材和任务入口。将清单返回的目录传给 `npm run services:build -- visual --build --web-release`，并使用 `deploy/project-owners.compose.yaml` 中的 Visual 状态卷和身份凭据。安装时核验程序文件与 Visual 的发布 API 摘要。旧程序的写请求返回 409。

模型选项和验收模型通过 Identity 将原请求委派给 Models。Models 在自己的账号库筛选可用条目，只返回界面所需字段。五容器隔离运行 `fpl-visual-browser-9163104183` 在 Chromium 验证四个入口、390／768／1440 宽度、画布保存和过期浏览器版本拒绝，并在重启后核验项目与模型目录。剩余公开操作和正式历史导入继续由 Visual 就绪门禁跟踪。

Visual ZIP 导入使用 `deploy/visual-snapshots.compose.yaml`，与 `deploy/project-owners.compose.yaml` 一起加载。将独立的 `FPL_VISUAL_ARCHIVE_KEY` 以受保护的文件挂载到 Visual 和 Assets，分别运行两者的 `migrate`。副本公开前核验原件摘要、目录、画布、输出历史、验收关联和同账号模型绑定。结算回执中断时，启动同版本 Visual 与 Assets 以恢复原批次。导入完成后可以再次从同一 ZIP 创建新的项目副本。

Visual 生成任务与批次需要 `deploy/visual-generation.compose.yaml`。将独立的 `FPL_VISUAL_GENERATION_KEY` 只读挂载给 Visual 和 Models，分别运行两者的 `migrate`。Visual 按画布版本提交任务，Models 保存执行计划和供应商回执，Assets 只在画布结果事务确认后公开原件。图片和视频继续按原账号等待队列与执行额度运行。未确认的结果保持可恢复，已提交但结果未知的供应商任务禁止重提。

视觉验收的固定模型回执使用 Models 的 0018 迁移。Models 只返回固定连接的公开投影，保留同账号同运行 ID 的精确请求摘要、结果和调用日志。中断后未知的供应商调用禁止重提。Rendering 通过 Assets 的同项目版本化原件进行基础取样，自动取样与手动区间取样分别授权。

节点固定模型验收另需 Visual 的 0009 迁移。Visual 冻结画布和方案版本后登记原件，逐来源结算 Assets 证据回执，随后经 Identity 复核执行账号并调用固定模型。Visual 重启后从已有证据和模型回执续跑。隔离七容器运行 `fpl-visual-node-native-283354a174` 验证真实 FFmpeg 取样、封闭 SSE 夹具、Chromium 页面和重启后的证据摘要。Mac CLI 验收需要 `deploy/agent-runtime.compose.yaml`、Agent Runtime 的 0002 迁移及已登记的 Mac worker。以 `fpl_host.agent_connections_worker` 启动同一版本 worker，使用独占的 TOML 与原生凭据，固定连接由可信本机设置启用。Agent Runtime 只为仍有效的租约提供同项目保留素材。追加帧以 SHA256 核验，发布后由 Assets 持有。Agent Runtime 的暂存保留至执行截止后一小时供回执恢复。隔离七容器运行 `fpl-visual-native-agent-531ece22b9` 经回环原生网关启动真实受限 CLI 子进程，核验 MCP 媒体操作、追加帧摘要、容器重启和 Chromium 入口。

Visual 助手的私网模型轮次需要 Models 的 0019 迁移。Models 绑定账号、项目、对话和运行，持有固定模型签名、额度和唯一调用日志。已完成轮次可按相同摘要重放，提交中断的轮次保持结果未知。公开消息流与审批继续使用原 URL 和 SSE v2 事件。

助手源事务需要 Visual 0010 和 Models 0020 迁移。叠加 `deploy/visual-assistant.compose.yaml`，将独立的 `FPL_VISUAL_ASSISTANT_SETTLEMENT_KEY` 只读挂载到 Visual 与 Models。结算只接受同账号、同运行、同追踪标识的短时服务签名。原始请求授权仅用于当前请求。

批准后的助手生成另需 Identity 0009 迁移。Identity 登记原账号、审批、项目、生成任务和计划摘要，结果发布时复核原账号授权并封存文件长度与 SHA256。Visual 将生成任务和对应画布节点一并提交。

Visual 就绪探针要求归属清单中的 58 个操作均已装配，并检查浏览器发行包、Visual 归档、Visual 生成、助手结算与剪辑交接配置及后台执行器。SSE 在等待审批期间复核会话。撤销后取消待执行动作，并通过已登记的服务结算回执恢复调用日志。七容器隔离运行 `fpl-visual-assistant-native-3a6f0fa198` 验证了就绪探针、Chromium 向实际 SSE 入口发送并审批、390／768／1440 宽度下的页面、画布落盘与重启后历史读回。模型响应来自封闭的 HTTPS 夹具。

### Galgame 工坊的浏览器版本与故事验收

运行 `npm run services:build:web -- galgame`，将清单目录传给 `npm run services:build -- galgame --build --web-release`。在 `deploy/project-owners.compose.yaml` 中使用 Galgame 专属状态目录和 Identity 凭据。项目列表、总览、编辑和已保存 Story 预演由 Galgame 镜像提供，旧版本写请求返回 409。

四容器隔离运行 `fpl-galgame-browser-77e550aeb2` 通过网关导入 Story 1.3、检查引用范围、下载并比较保留文件字节，以及设置项目完成状态。Chromium 打开四个入口并验证 390／768／1440 宽度。Galgame 与 Assets 重启后复核同一 Story、线路报告和素材。项目写入、生成任务和完整历史的其余接线仍由就绪门禁跟踪。

Galgame 快照 ZIP 导入使用 `deploy/galgame-snapshots.compose.yaml`，与 `deploy/project-owners.compose.yaml` 一起加载。将与其他凭据独立的归档密钥文件传给 `FPL_GALGAME_ARCHIVE_KEY`，只读挂载在 Galgame 和 Assets。启动前分别运行两者的 `migrate`。导入后先读回副本的线路报告，再按 ZIP 清单检查下载文件的 SHA256。若提交已落盘而发布回执中断，启动原版本服务以恢复该批次的发布。

完整 Galgame 装配覆盖归属清单中的 52 个公开操作。`/ready` 要求发布版本匹配、归档密钥已挂载且后台执行器健康。剪辑交接还需要 `deploy/video.compose.yaml`，使用其中的 Video 归档配置。隔离验收在剪辑工坊打开目标时间线，随后重启 Galgame、Rendering 和 Video 并读回相同的目标项目 ID。
