# AGENTS.md

## 开始前

- 每次正式处理仓库任务前先阅读本文件；所有命令默认在仓库根目录执行。
- 本项目定位为单机部署的模型基础设施管理台，支持单机独立应用服务、每服务 SQLite 和按账号隔离的私人数据；实时语音仅用于模型测试，不引入 Bot、模型检索知识库（RAG）、电话接入、浏览器扩展或多实例部署能力。
  思绪工坊中的「知识库」仅表示文档项目容器，普通文档归当前账号私有；知识社区通过显式发布和逐篇授权开放给同一部署中的登录账号，不授予源账号私人资源访问权。AI 写作仅通过 Agent/SDK 接入，应用内无入口。
- 目录职责以 [`docs/architecture/project-layout.md`](docs/architecture/project-layout.md)
  为唯一完整索引；新增目录或改变职责时同步更新该文件。
- Python 命令与临时诊断优先通过 `uv run` 执行。
- 代理为仓库任务主动生成且需要落盘或保留的临时输入、诊断文件、截图、渲染中间结果、导出草稿和本地验收产物，
  必须统一放在仓库根目录的 `.local/` 下，并按能力或任务使用清晰的子目录；创建前先用 `git check-ignore`
  确认目标路径已被忽略。不得在仓库根目录或受版本控制目录另建 `scene-output/`、`output/`、`tmp/`
  等临时产物目录。用户明确指定的正式交付路径和工具自身不可配置的短生命周期系统临时文件不受此限制。
- 仓库二进制资产使用 Git LFS；缺少对象时先按路径选择性 `git lfs pull`，不得把 LFS 指针当作字体、
  模型或图片内容处理。
- 后端持久配置只放在 `backend/config.toml`，按分组使用 TOML 原生类型；进程环境变量可供测试与部署覆盖。
  `.env` 仅用于一次性转换，成功后归档为 0600 备份，不再读取。不得提交真实配置或备份，不得输出密钥。
  `backend/fpl_config/` 是不依赖运行时 `app` 或数据库的共享配置格式和转换模块。
- 非机械性的行为、架构、跨文件契约、流程工具链、测试策略或落盘/网络/配置格式改动，按
  `docs/operations/agent-notes.md` 在 `.agents/notes/` 创建或更新 Agent Note；纯格式化、样式、无歧义重命名和局部机械修复免写。
- `web/src/docs/`、`web/public/docs/`、文档中心覆盖清单和 `scripts/generate_sdk_docs.py` 是产品文档中心的受保护内容。工程决策整理不得迁移、删除、重写或重新生成这些路径。
- 思绪工坊的 `web/src/features/thought-workshop/official/content/` 是知识库版主要使用指南；修改用户行为时同步维护对应正文。官方文档是管理员维护并发布的普通笔记；内置 Markdown 与图形仅构建管理员主动导入包，导入不自动发布，升级不覆盖已导入内容。官方标记仅平台管理员可设置，只读、可见范围与编辑授权独立校验；现有文档中心继续按原保护规则维护。
- 技术文档正文与旁置图形同步反映当前实现。画板持久化使用 `CanvasScene.sceneVersion` 契约，不保存 React Flow 运行状态；前后端校验和静态 SVG 布局规则保持一致，图片只引用经账号归属校验的托管素材。
- 官方文章遵守 `docs/operations/official-knowledge-writing.md`：操作步骤带可验证结果，技术图解释实例与边界，每篇维护简介和相关阅读。导入转换只解析受控 Markdown 提示框，运行期共用标准富文本阅读组件，关闭原始 HTML；菜单和弹窗不得重建图形、重置视口。

## 代码编写原则

- 编写或修改代码时避免循环依赖、跨模块访问内部实现、共享可变状态和隐含的数据传递。
  按真实业务职责拆成接口明确、可独立替换的组件或功能切片。删除、复制、内联或重写一个组件时，
  不应需要理解或改写其他组件的内部实现；不要为了拆分而增加无业务意义的层数或文件。
- 动手实现前明确数据如何流动：输入来自哪里，经过哪些校验与变换，输出给谁，哪些状态需要持久化，
  并发、失败和恢复时如何保持一致。跨模块通过明确契约传递数据，不共享可变的内部状态或隐含上下文。
- 实现用户行为时检查明显漏洞、性能退化、错误恢复，以及不同页面和入口对同一操作的权限、状态与
  反馈是否一致。抽象必须准确表达业务概念，不把不同生命周期的状态或职责强行合并。
- 将局部实现问题限制在组件边界内，让单个组件可以重写而不牵动全局。组件内部的冗长或小瑕疵不应
  成为跨模块耦合的理由；已知 Bug 仍需修复，下文的单文件、目录体量和质量门禁仍需遵守。

## 常用命令

- 安装后端与 Web 依赖：`npm run setup`。
- 一键启动后端与 Web：`npm run dev`；单独启动使用 `npm run dev:backend`、
  `npm run dev:web`。
- 当前分支 `npm start` 与 `website:service` 使用独立服务协调器，正式安装仍受全部服务与迁移门禁约束。迁移期单体恢复入口为 `npm run start:legacy` 与 `website:service:legacy`；构建旧网站资源为 `npm run build:studio`。
- 开发使用 `.local/dev-runtime/` 和后端 9001，正式数据位于 `.runtime/`，自动测试不得读取正式数据。
- 数据库迁移：`npm run db:migrate`；只检查迁移状态：`npm run db:migrate:check`。
- OpenAPI 生成与 stale-check：`npm run contracts:generate`、`npm run contracts:check`。
- 测试：`npm test`；浏览器端到端测试：`npm run test:e2e`。
- 质量检查：`npm run lint`、`npm run format:check`、`npm run build`；需要自动格式化时使用
  `npm run format`。
- Git LFS：`npm run lfs:check:pointers` 检查指针，`npm run lfs:check` 检查生产运行资产。
- Agent Note：`npm run verify-notes` 检查树结构、格式和归档封印；`npm run check-docs-center-protected` 检查文档中心保护路径。

## 应用与目录边界

- 经用户批准，正在将网站单体迁往同仓库独立服务和 Docker Compose。`backend/fpl_runtime/` 拥有无业务 ORM 依赖的服务清单、身份断言、路由与存储契约；`backend/fpl_deployment/` 拥有构建、归属检查和受控部署，不能成为业务实现层。每个服务独立数据库、迁移、Runner 和版本，不加载单体全部 ORM，不跨服务直接读写数据库。
- `backend/fpl_management/` 拥有独立管理页面、运维回执、自有数据库与迁移，不导入 Identity、Models 或工坊 ORM；治理请求经管理网关直达所属服务。本机启停、日志和双隧道由 `fpl_host/management.py` 的受认证回环 worker 执行，容器不持有 Docker Socket 或主机凭据。Identity 自有迁移和服务端用途校验隔离管理会话；旧单体仅作迁移期恢复入口。
- `backend/fpl_identity/` 装配账号独立服务，自有账号事件与迁移；复用治理用例但不得依赖模型或工坊 ORM。账号创建使用显式事务回调，单体入口注入旧目录初始化，Identity 注入持久事件。镜像从静态源码闭包构建，不能复制全部后端。
- 注册和开发文档协议分别归 `console/schemas/registration.py`、`developer_documents.py`；Identity／Portal 直接引用所属协议，不能经旧治理 schema 的兼容导出加载模型模块。
- `backend/fpl_gateway/` 拥有稳定网关控制面、能力发现、有归属校验的资源链接和去重变更游标；不导入门户、工坊或 Identity ORM。跨应用查询必须使用绑定原请求与目标用途的委托，不能用服务凭据任意代理账号。Caddy 与控制面共用一个 Gateway 发布单元，进程互相监督。
- 应用卡片状态由 Gateway 就绪探针与 Mac worker 的新鲜生命周期观测共同判断；只有确定的主机观测才可标记已停止或未部署。状态读取仅开放浏览器 Session，委托只允许读取 Management 的精简服务列表，不开放日志、路径或运维操作。刷新失败时历史结果不能继续表示当前运行正常。
- `backend/fpl_agents/` 拥有工作台独立装配、版本化原生采集协议、任务与帧回执、自有迁移和协调器；不加载 Identity ORM 或原生读取器。`backend/fpl_host/` 仅在 Mac 运行，主动连接回环入口；原生读取与检查点跟随不取得容器数据库或通用执行权限。工作台使用显式认证与存储依赖，单体适配入口仅作迁移期兼容。
- `backend/fpl_portal/` 拥有首页、应用目录、文档页面与原有浏览器专用开发文档 API；不加载工坊、账号 ORM 或 Runner，也不接收加密密钥。应用目录元数据归 `web/src/features/applications/definitions.ts`，不能为展示目录而导入各应用的懒加载页面注册表。受保护文档只作为原样构建输入，程序截图通过白名单跳转到所属版本。
- `backend/fpl_assets/` 拥有独立素材引用集合、幂等回执和文件清理队列；素材删除与引用替换使用同一服务的短写事务。新资源修改通过独立准备意图保留素材；源数据与回执同事务保存后确认，确认回滚后才能撤销。确认乱序不能覆盖更高源版本或释放更晚准备的素材，未知结果不得按时间清除。文件清理按持久回执逐项恢复，不跨服务查询表或递归删除目录。Assets 配置仅含自有存储路径和文件限制，不取得加密密钥；项目归属查询通过绑定原账号请求和用途的接口完成。私有引用协议使用 Identity 签发且绑定单次修改摘要的授权；新准备必须复核有效身份，已接受意图只允许结算该次结果。授权不是文件读取或任意任务凭据，源服务必须持久保存授权与自己的操作回执。项目文件引用位置归 Assets 自有 `VisualProjectFileLink`，与文件夹同库级联，源作品及历史仍归原应用。旧 Visual 引用 ORM 只作单体兼容与迁移来源。完整容器、引用调用方及受控数据转移验收前不得宣称 Assets 切换完成。
- `backend/fpl_rendering/` 通过受限委托读取同一素材的 HTTP 字节，不加载 Assets ORM 或挂载其数据库。当前仅承接五个兼容预览／媒体处理接口，确定性导出任务仍待拆分。纯栅格解码归 `runtime/raster.py`，Identity 头像不导入素材库。Assets 大上传暂存使用自有状态卷，不能依赖容器的小容量内存临时盘。
- `backend/fpl_models/` 拥有独立模型服务的默认选择、完整自有表清单与迁移，尚无完整运行装配。目录通过显式默认值存储端口保留 CAS；恢复网站显式装配旧设置与任务占用端口，`llm/catalog/legacy.py` 仅供旧治理用例复用，独立 Models 不得导入旧适配器或跨库读取账号表。账号、源素材和工坊任务 ID 是跨服务不透明引用；独立 schema 仅保留自有表外键，旧单体 SQL 历史及物理约束不改写。
- Identity 的账号创建与目录事件同事务提交；Models 仅通过私有版本化轮询／确认协议消费。`fpl_models/provisioning.py` 将本账号目录与不可变事件摘要回执同事务落盘，提交后才确认源事件；已有目录不重置。新初始化使用 Identity 短期有效的当前账号状态，不能把历史创建角色作为授权；停用账号暂不投递。`fpl_models/templates.py` 提供只做本地事务的角色策略初始化回调，策略自有 CAS 表与任务占用检查不导入旧设置或工坊 ORM；完整治理 HTTP、审计及服务装配仍待接通。
- `llm/catalog/template_reconciliation.py` 拥有保留 ID、自建项与有效默认选择的模板合并规则，通过显式默认值与账号任务占用端口运行；不得替换已有账号绑定。恢复网站的 `console/governance/model_templates.py` 仅保留旧设置、审计、授权与跨工坊占用适配；正常业务写入仍经所属服务 API，不能把存储方法当作运维修库入口。
- 模型 Runner、恢复、文字流与实时语音结算必须接收明确的会话工厂，所有 LLM 模块不得直接导入单体全局数据库工厂；HTTP/WebSocket 传入自己的 ASGI 绑定。结算短事务显式绑定账号，不跨网络等待共享 AsyncSession。`llm/http_credentials.py` 从已经验证且与 Principal 匹配的 Identity 上下文取得历史调用归因；实时语音只接受已经认证的浏览器 Principal。恢复网站显式安装 `llm/call_logs/credentials.py` 的旧账号查询，独立服务不加载该适配器；完整 Models 装配仍须完成其余存储和原生端口。
- 后台任务通过 `runtime/task_records.py` 从本服务持久任务解析账号，已有会话绑定不得替换；系统读取只能枚举恢复账号与任务 ID，恢复写入按账号使用独立短事务。此内部查找不是浏览器或跨服务调用授权。`llm/inference/storage.py` 拥有推理输入／输出目录和启动期未提交文件核对，不查询 Identity 账号表，不跟随符号链接或清理其他应用目录。
- 模型目录 HTTP 通过 `llm/catalog/http_bindings.py` 从当前应用取得默认模型存储与任务占用端口，路由不得直接构造旧数据库适配器。模型诊断与目录装配分离，共用错误映射归 `llm/http_errors.py`；缺少目录绑定时拒绝请求，不回退旧数据库。
- 模型 HTTP、实时语音及派生任务从当前 ASGI 应用的 `llm/admission.py` 绑定取得额度生命周期，缺少绑定拒绝新任务，不直接导入旧治理账本。推理幂等回执查询归 `llm/inference/receipts.py`，重放不申请新额度；额度绑定本身不代替跨服务任务授权或独立账本实现。
- `fpl_models/admission.py` 拥有 Models 自有任务的持久额度账本；全局统计仅对固定自有表执行聚合，不返回其他账号记录。配额策略使用 `0005_quota_policy` 自有 CAS 表；任务与额度关联同事务提交，不允许重复关联或改绑。缺失记录、未知状态和供应商提交中断保留占用；只有启动前恢复可释放失去进程的同步调用额度。额度接口不授予任务执行权限，完整排队授权、Runner 结算和治理审计仍须接通。
- 用户已确认管理端也采用独立服务和独立数据库，通过 Identity/Models 接口治理，不与业务服务共同写旧 SQLite。并行管理端任务的接口稳定后统一纳入部署。
- 当前正式网站在多服务切换门禁通过前继续由现有入口运行；以下单体入口说明作为迁移期的恢复契约。新架构原生 Mac worker 主动连接受认证回环任务入口，容器不得挂载整个用户目录、个人 CLI 凭据或 Docker Socket。

- `backend/app/` 按垂直切片装配：`main.py`、`deps.py`、`problem_details.py`、`api.py` 与
  `orm.py` 负责应用装配；无业务语义的基础设施归属
  `runtime/`；有契约的共享能力归属 `capabilities/`（含 asset_store 自有 VisualAsset ORM、files 契约与媒体
  routes/schemas）；Studio
  治理与库级文件用例归属 `console/`（含自有 models/routes/schemas）；已垂直切片的产品 App 归属 `apps/`（目前
  `presentation_workshop`、`audio_annotation`、`thought_workshop`、`video_editor`、`visual_workshop`、
  `galgame_workshop`、`director_desk`、`motion_compositor` 已迁入）；`llm/` 拥有目录/供应商/测试台/推理与自身 models/schemas/routes；
  `integrations/`、`tool_navigation/`、`demo_runtime/` 各自拥有 models/schemas/routes（demo 无独立 ORM）。
  顶层不再保留 `models/`、`schemas/`、`routes/` 横向包。
- 路由模块不得直接导入 SQLAlchemy、ORM 模型或 `db.migrations`，不得自行持有查询、写入和
  事务规则。它们只校验请求、调用功能模块并把领域结果或错误映射为协议响应；`apps/*/routes/`、
  `llm/routes/`、`console/routes/`、`capabilities/*/routes/` 与各业务包 `routes.py` 遵守同一边界。
- `app/deps.py` 只使用当前 ASGI 应用显式绑定的会话工厂与已验证身份，不导入账号 ORM 或单体数据库工厂。浏览器凭证的数据库校验在 `console/governance/database_auth.py`，仅 Identity 与恢复网站装配该适配器；独立业务服务不得回退读取 Cookie 或账号表。WebSocket 必须有明确的认证适配器。
- 不新增 `services/`、`domain/`、`platform/`、`product/` 等通用后端抽象层目录。需要拆分时，
  在所属能力内按具体职责命名文件或子包，例如 `llm/catalog/`、`capabilities/asset_store/`。
- 业务 API 统一注册在 `/v1`；只有 `/health` 与 `/ready` 作为根级探针。
- 浏览器是唯一客户端。`runtime/website.py` 拥有可信监听入口和静态页面，`scripts/website/serve.py` 在数据库导入前加载 TOML、核验迁移并持有正式数据锁；存在待处理迁移时拒绝启动，不在重启时执行未核准迁移。原桌面代码仅保留于归档分支。
- 正式网站数据保存在项目 `.runtime/`，本地模型位于 `.runtime/local-models/`，配置仅在 `backend/config.toml`。从桌面迁入时唯一源为当时正在使用的 Application Support/Future Props Lab；完整停机、备份、核验后迁入，不与项目旧开发库合并，不更换加密密钥。原目录和恢复快照在验收前保留。
- 本机 9000 与公网回环 28081 共用一个 ASGI 应用和 Runner 生命周期。`capabilities/web_access/` 拥有附加监听器与专用 SSH 生命周期；附加 lifespan 关闭。本机管理权限依据实际 socket，不信任客户端 hostname 或转发头。公网管理员也不得管理主机目录、Codex、磁盘或访问配置；相关菜单只在本机入口显示。
- 网站静态资源通过 `build:studio` 构建清单、哈希与压缩文件；云端仅托管程序。`/v1`、私人素材、SSE 不进入共享缓存，HTML 回退不覆盖未知 API 和缺失资源。公网启动要求构建匹配。
- Amadeus 新对话由已登记的 Codex、Claude Code、OpenCode、DeepSeek Harness 或 Pi CLI 执行；FPL 后端持有运行、事件、审批和恢复，CLI 仅获得任务工具授权，不继承个人工具或通用 Shell。连接部署配置归 TOML，按账号／用途的授权归治理；固定业务任务共用连接注册表并保留自有任务边界。外部 CLI 的模型和认证配置按白名单读取，执行配置、插件和工具目录不直接继承。
- CLI/SDK/MCP 使用网站地址和 Management API Key。`console/governance/automation_operations.json` 维护业务白名单，`/v1/automation` 提供能力发现与有归属校验的资源链接；不控制浏览器标签页，不开放账号治理、密钥管理或任意系统命令。客户端凭据目录 0700、文件 0600，不通过参数或日志传递密钥。
- Amadeus 使用当前页面侧栏和显式账号上下文接口，不依赖原生窗口或 IPC。下载与演示窗口使用浏览器能力，并保留弹窗阻止反馈和未保存保护。
- 独立应用浏览器入口归 `web/src/app/entries/`，由 `web/service.config.ts` 与 `web/scripts/build-service.mjs` 单独构建。程序资源按服务及不可变版本托管，私有 API 与素材不进入程序缓存。`fpl_runtime/web.py` 核验文件哈希和所属接口契约，只拒绝相应应用旧页面的写入，不阻断其他应用或 SDK。
- Web 保持 `app/ + features/ + shared/ + platform/ + generated/`：`app/` 负责入口、壳与路由，
  `features/` 拥有业务页面和用例，`shared/` 放无业务归属的复用 UI，`platform/` 放 API 与认证
  基础设施，`generated/` 只保存生成契约。
- Web 的 `platform/` 与 `shared/` 不得依赖 `features/` 或 `app/`，`features/` 不得依赖
  `app/`；业务代码不得堆回 `web/src/` 根目录。生产请求通过 OpenAPI 生成类型访问后端，
  `generated/` 文件不得手工编辑。
- Models、Visual Workshop、Thought Workshop、Presentation Workshop、Audio Annotation 与 Integration Center 的 TanStack Query 键由各自 `queryKeys.ts` 唯一
  维护；跨功能消费者导入 owner 的 key factory，不得复制同名缓存键。鉴权文件预览统一使用
  `platform/api/useApiBlobUrl.ts` 管理取消、竞态和 Object URL 回收；自有缓存或多音轨播放器除外。
- Web 中面向用户可见的交互控件不得直接暴露浏览器默认外观或原生弹层。下拉菜单、颜色选择、
  日期选择等必须使用项目自绘组件并适配明暗主题；原生 `select`、`input[type="color"]`、
  `input[type="date"]` 仅可作为完全隐藏的底层能力，不能作为最终可见 UI。新增或修改页面时应
  同步检查键盘操作、焦点状态与无障碍标签，避免因浏览器或操作系统不同出现不一致样式。
- 模型目录修改通过 `llm/catalog/task_usage.py` 的显式任务占用接口检查活动任务，不能在目录本体查询工坊内部表。迁移期单体仅由 `legacy_usage.py` 承接原有同库查询；独立 Models 必须注入自有执行记录实现，缺少实现时拒绝相关写入。
- 模型与供应商差异在 `backend/app/llm/providers/` 的适配边界内归一化。公共 REST/SSE、模型
  测试和调用日志契约保持供应商无关；供应商管理页面可以展示配置，但前端运行流程不得依赖
  供应商原始事件。
- 图片/视频后台任务的状态转换由 `llm/generation_runtime.GenerationTaskDriver` 唯一编排；各功能
  只提供任务存取、素材组装/落盘和调用日志钩子。`submitting` 中断必须安全失败，禁止自动重提。
- 确定性时间线画面与视频渲染由 `backend/app/capabilities/media_rendering/` 统一拥有；Galgame 直接导出不得
  依赖 `video_editor/` 实现，只有显式的视频编辑器交接用例可以跨功能调用。
- ORM 的 ID/时间默认工厂由 `runtime/ids.py` 与 `runtime/time.py` 维护；各包 ORM 模型只依赖
  `runtime.orm_base` 与上述工厂。生产 Python 包不得形成强依赖环。账号项目记录的加载、CAS
  更新和删除原语可复用 `runtime/project_records.py`，但事务、默认文档、快照和领域规则必须留在所属功能包。
  编辑批处理回执与传输形状归属 `runtime/project_operations.py`、`runtime/operation_batches.py`。
- Story 总校验保持纯函数分层：身份/角色、素材、国际化、时间轴、流程与表现层规则归属
  `apps/galgame_workshop/schemas/story_validation.py`；Pydantic Story 入口只负责迁移适配和统一调用。
- 鉴权原语归属 `capabilities/identity/`；账号、Session、审计、Management API Key 与平台资源分配归属
  `console/governance/`。仅有 `admin` 和 `user` 两种平台角色。管理员不具有其他账号私人数据的读取权。
  `StudioPrincipal.user_id` 是私人数据唯一归属来源，`owner_user_id` 与它相同；业务请求不得接受客户端指定归属。
  路由通过 `OwnerDep` 传递账号，根资源保存 `owner_user_id`，子资源继承已经校验的根资源归属。
  不存在 Workspace、成员角色、动态权限矩阵、账号切换空间或 `default` 回退；后台执行器从持久任务恢复账号。
  `AssetStorage` 的项目路径与写入方法必须显式传入账号；跨账号 ID 按不存在处理。
  HTTP `UploadFile` 只在路由中出现，业务用例依赖 `capabilities.asset_store.IncomingFile`。
- 思绪工坊 `publication/` 拥有发布与逐篇授权，社区接口仅使用浏览器 Session；先验证发布记录、当前文章与有效角色，再在独立会话中显式绑定源账号。素材仅开放可读正文实际引用的文件与发布封面；不开放历史、私人目录或普通文件库查询。正文仍由 Notes 用例执行校验、CAS 和历史，回收站事务同步撤回发布，恢复不自动重新发布。
- 固定账号权限由 `capabilities/identity/permissions.py` 维护，业务 HTTP/SSE 操作必须登记在
  `capabilities/identity/route_permissions.py`；架构测试禁止未登记路由。Web 统一消费 Principal 的有效权限，
  只读浏览页面由各功能模块拥有，账号查询键由 `features/accounts/queryKeys.ts` 唯一维护。
- 平台模板同步项与运行额度 ORM 归 `llm/models/`，数据由 Models 服务拥有；恢复网站的治理用例仍在 `console/governance/`，资源分配必须显式校验。固定演示运行时
  `demo_runtime/` 不得依赖账号治理或模型目录，治理入口仍在 `console/governance/`。
- Web 不保存密码、Session、CSRF 或 Management API Key 明文；Session 只使用 HttpOnly Cookie，
  写请求统一携带可读 CSRF Cookie 对应的请求头。API Key 明文和临时密码只允许展示一次。
- 修改安装、启动、环境变量、依赖或目录路径时，同步检查根与 Web 的 `package.json`、
  `pyproject.toml`、脚本、README 和 CI/测试入口。
- `scripts/demo/` 只保存内容专用演示维护工具；必须通过正式 API 操作，并要求调用者显式提供项目 ID、
  素材根目录和输入/输出路径，不得保存本机绝对路径或默认目标项目。

## SDK 与文档契约

- Python SDK 位于 `sdk/python/`，不依赖后端运行时。`generated/` 由 OpenAPI 和 `operations.json` 生成，不手工编辑。
- 修改公共接口后运行 `npm run contracts:generate`，同时更新 SDK 与文档参考；`npm run sdk:check` 检查生成物。具名方法覆盖不等于业务闭环测试。
- 独立模型任务归属 `llm/inference/`；备份账号时一并保留 `model-inference/inputs/`、`model-inference/outputs/`。提交中断禁止重新提交供应商。

## SQLite、迁移与并发

- `.runtime/future-props.db` 是默认单机 SQLite 真源。FastAPI 启动时会自动应用已登记迁移，
  并为连接启用外键、WAL 和忙等待；不要把该行为替换成 Sayflow 的 PostgreSQL 多实例方案。
- 绝对禁止通过 `sqlite3`、临时 Python/SQL 脚本、数据库客户端或其他绕过应用的方式，直接对
  任何持久数据库执行数据写入、修复、删库重建或 schema 修改；不得手工修改
  `schema_migrations`、迁移 checksum 或伪造迁移状态。命令行诊断仅允许只读查询。
- 运行期数据的创建、更新、删除、修复、导入、回填与管理能力必须设计为正式的 `/v1` API，
  经所属功能模块执行业务校验、事务、并发控制和错误映射；Web、测试工具与运维流程统一调用
  该 API，不得把直接操作持久数据库作为实现方案或故障恢复步骤。仅允许存储层和迁移测试在
  各自创建的临时隔离数据库中直接构造测试状态，测试结束后不得影响任何持久数据库。
- `npm run account -- create-admin|create-user|reset-password` 是账号恢复的离线入口，但只能调用
  `accounts/` 中与 HTTP 共用的正式用例，不得执行裸 SQL；账号与其模型目录在同一事务创建。
- `db/migrations/` 是现有单体的唯一 schema 迁移入口；独立服务使用自有版本注册表，由 `fpl_runtime/migrations.py` 显式执行并核验数据库服务归属，启动不自动迁移。已登记迁移的 ID、顺序和 SQL 不得改写；修复或
  扩展只能在 `versions/` 追加新版本并更新 `registry.py`。
- 独立服务迁移在任何可写设置前通过转义后的只读 URI 校验位置、服务、版本和 checksum 前缀；打开目标连接后再次校验，再启用 WAL 或创建 schema。拒绝归属错误、历史漂移或未登记旧库时不得改变其文件、权限或日志模式，不能修补迁移记录来通过门禁。
- schema 演进只能通过新增并登记 migration 完成；migration 可以承担 schema 所必需的确定性
  数据变换，但不得替代面向运行期数据管理的 API。迁移首次写入真实持久数据库前必须先在
  临时测试数据库完成验证并定稿，禁止一边运行应用自动迁移一边继续修改同一 migration。
- 任何 schema 或持久化兼容性变更必须同步更新 ORM、追加 migration、更新注册表、测试和
  数据/API 文档。迁移包不得导入运行时 `app`。
- `AsyncSession` 是单任务资源，不得由并行分支共享。外部模型请求、网络等待或大文件 I/O
  不得放在已经开始写入的长事务中；流式生成应使用独立短事务准备和结算状态。
- 整体 JSON、配置和会话等 revisioned 资源使用数据库 CAS：缺少 revision 返回 422，冲突
  返回 409 与当前快照，客户端不得静默覆盖。
- 备份数据库前先停止应用，复制完整运行目录与配置，包含 SQLite、`accounts/`、`profiles/`、
  回收站和升级保留的旧文件；不要把
  `.runtime/` 当作可提交的代码、
  迁移或测试资产。

## 测试、文档与质量门禁

- 后端单元/API/存储测试位于 `tests/`；Web 组件测试位于 `web/tests/`，浏览器旅程位于
  `web/e2e/`。可自动化验证的行为不得只写成人工说明。
- 架构测试用于守住依赖方向、迁移独立性、路由版本和核心目录；修改架构规则时应同时更新
  `AGENTS.md`、项目结构文档与对应测试，避免出现多个互相矛盾的事实源。
- HTTP 或 SSE 契约变化必须更新后端 schema/路由、OpenAPI 生成物、Web 消费端、API 参考和
  契约测试。
- 按改动范围运行 `npm test`、`npm run lint`、`npm run format:check`、
  `npm run contracts:check` 和 `npm run build`；缺少真实凭证时明确报告相关测试未执行，不得
  用真实供应商调用代替确定性测试。
- 单文件软上限：生产 Python 900 行、TS/TSX 1000 行、CSS 800 行，测试文件 1200 行；OpenAPI 等
  生成文件排除。没有任何尺寸豁免机制，超限只能按语义拆分，不得为了过门禁做机械切片。
- 真正约束体量的是目录预算：`web/src/apps|console` 与 `backend/app/apps|console|capabilities`
  下每一层目录直接持有的源码不超过 6000 行，超出必须再分出命名子域。这些目录内的文件名不得带
  `-foundation`、`-components`、`-interactions`、`-part\d*`、`-base`、`-extra`、`-misc` 后缀，
  也不得出现只做转发的空壳 `@import` 样式。不得新增编号式 CSS 分片；构建预算脚本只读产物，
  不得在构建后拆分或改写 CSS。
- App 之间默认零互相依赖。例外仅限视频剪辑向视觉创作工坊的片段交接、特效制作向视频剪辑工坊的成片交接，登记在
  `tests/test_architecture.py` 的 `ALLOWED_APP_HANDOFFS`，且必须经目标 App 的公共入口。
- 新增 Web 路由或独立 HTML 入口时，同步更新 `web/e2e/responsive-inventory.ts` 与相应适配用例；
  页面不得依靠根级隐藏横向溢出来通过检查，复杂区域使用明确的局部滚动和可点击操作入口。
- 修复问题时先定位根因和同类风险；保留用户已有的未提交改动，不覆盖或顺手重写无关文件。
- 新增或替换 `docs/` 图片、固定字体或 VAD 二进制时同步更新 `docs/assets/MANIFEST.md`，并执行
  `git lfs fsck`；未核清来源和许可证的演示素材不得视为可再分发资产。

## 账号归属升级

- `0116_account_ownership` 是逻辑空间移除的唯一 schema 迁移，旧空间按唯一活动 Owner 归属；没有唯一 Owner 时拒绝迁移。
  历史迁移不改写，旧 Session 与 Management API Key 全部撤销。角色 `super_admin/admin` 合并为 `admin`，`member` 变为 `user`。
- 文件归属清单由 `capabilities/asset_store/account_upgrade.py` 和正式布局 API 执行，路径为 `accounts/<user-id>/`。
  迁移期间仅允许身份与管理员布局升级接口，后台任务不启动；逐文件校验后落盘，拒绝链接和异内容覆盖，保留原文件作恢复副本。
  完成后必须重启应用；开发测试只使用隔离数据库，禁止自动升级或重启未核准的正式实例。
