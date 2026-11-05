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
  `backend/studio/config/` 是不依赖业务应用或数据库的共享配置格式和转换模块。
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
- 一键启动固定热加载后端与 Web：`npm run dev` 或 `npm start`；`dev:backend`、
  `dev:web` 兼容别名也启动同一整套服务，不再单独启动。
- 网站正式启动：`npm start`；构建资源：`npm run build:studio`；用户级后台服务：`npm run website:service -- install|start|stop|status|uninstall`。
- 日常开发沿用 `backend/config.toml` 和 `.runtime/` 的现有账号、模型及素材，前端固定回环 3000、后端固定回环 9001；自动测试必须显式使用临时隔离配置与数据库，不得读取现有数据。
- 数据库迁移：`npm run db:migrate`；只检查迁移状态：`npm run db:migrate:check`。
- OpenAPI 生成与 stale-check：`npm run contracts:generate`、`npm run contracts:check`。
- 测试：`npm test`；浏览器端到端测试：`npm run test:e2e`。
- 质量检查：`npm run lint`、`npm run format:check`、`npm run build`；需要自动格式化时使用
  `npm run format`。
- Git LFS：`npm run lfs:check:pointers` 检查指针，`npm run lfs:check` 检查生产运行资产。
- Agent Note：`npm run verify-notes` 检查树结构、格式和归档封印；`npm run check-docs-center-protected` 检查文档中心保护路径。

## 应用与目录边界

- 原 `fpl_*` 包与 `app/apps/` 业务切片已迁入 `backend/studio/`，不得重建旧目录或转发包。
  `apps/` 拥有业务，`contracts/` 按所有者保存纯协议，`runtime/` 拥有无业务归属机制，
  `assembly/independent/<owner>/` 拥有服务构造、CLI 和维护装配；主机入口在 `assembly/host/`。
- `studio/assembly/website/` 显式构造兼容网站：`application` 创建实例，`bindings` 注入组件，
  `lifecycle` 管理启停，`http` 与 `routes` 注册协议，`models` 限定网站会话规则。
  导入不读取配置或创建数据库；测试实例由隔离配置的 `tests/website_test_support.py` 拥有。
- `studio` 的父包初始化保持无副作用。`contracts`、配置格式、纯 `rules` 与 `use_cases`
  不导入 ORM、HTTP 框架、主机实现或应用内部模块。业务用例声明所需接口，装配注入存储与
  外部客户端；用例通过命令、快照和领域错误交互，不接收数据库 Session。
- 公共跨进程客户端归所属应用 `clients/`，允许进入其他服务镜像的具体模块由
  `studio/deployment/images.py` 登记。不能放宽成整个业务包；其递归依赖仍须通过存储隔离检查。
- `studio/runtime/database/` 拥有数据库、ORM 和迁移原语，`http/` 拥有传输适配，
  `tasks/` 拥有任务机制，`files/` 与 `messaging/` 拥有通用文件和签名载荷机制。
  业务状态转换、账号归属与原子提交规则仍属于业务所有者。
- 文件格式表归 `studio/contracts/asset_library/file_types.py`；字节检测、完整文件校验、SVG
  安全规范化、摘要及归档编解码归 `studio/runtime/files/`。目录暂存机制不决定应用布局，
  `runtime/database/project_files.py` 通过创建／删除布局接口执行原有事务补偿。
  导演台使用自有 `storage/file_paths.py`，两套装配显式提供存储，不继承素材库布局或读取全局配置。
- 音频标注文档编辑由 `EditDocument` 执行版本判断与纯转换，`DocumentEdits` 在一个事务内提交
  CAS 与回执；并发失败复查原请求回执，取消回滚。HTTP 层只映射领域错误。
- `backend/studio/` 全树纳入文件和目录行数预算；迁移路径同时更新入口、镜像闭包、打包、
  契约归属和测试。不得用空目录、软链接或永久转发表示迁移完成。
- `backend/app/` 暂时保留 `capabilities/`、`console/`、`integrations/`、
  `tool_navigation/` 的未归并实现。新业务进入 `studio`；后续迁移须按真实
  所有者分配这些实现，不能把它们整体搬入一个通用兼容包。`app/apps/` 已无业务源码。
- 路由模块不得直接导入 SQLAlchemy、ORM 模型或 `db.migrations`，不得自行持有查询、写入和
  事务规则。它们只校验请求、调用功能模块并把领域结果或错误映射为协议响应；`apps/*/routes/`、
  `studio/apps/model_service/transport/website/`、`console/routes/`、`capabilities/*/routes/` 与各业务包 `routes.py` 遵守同一边界。
- 不新增 `services/`、`domain/`、`platform/`、`product/` 等通用后端抽象层目录。需要拆分时，
  在所属能力内按具体职责命名文件或子包，例如 `studio/apps/model_service/catalog/`、`capabilities/asset_store/`。
- 业务 API 统一注册在 `/v1`；只有 `/health` 与 `/ready` 作为根级探针。
- 浏览器是唯一客户端。`runtime/website.py` 拥有可信监听入口和静态页面，`scripts/website/serve.py` 在数据库导入前加载 TOML、核验迁移并持有正式数据锁；存在待处理迁移时拒绝启动，不在重启时执行未核准迁移。原桌面代码仅保留于归档分支。
- 正式网站数据保存在项目 `.runtime/`，本地模型位于 `.runtime/local-models/`，配置仅在 `backend/config.toml`。从桌面迁入时唯一源为当时正在使用的 Application Support/Future Props Lab；完整停机、备份、核验后迁入，不与项目旧开发库合并，不更换加密密钥。原目录和恢复快照在验收前保留。
- 本机前端 3000、API 9001 与公网回环 28081 共用一个 ASGI 应用和 Runner 生命周期。`scripts/website/development.py` 是命令行和后台服务共用的单例启动器，先等待后端就绪，再启动前端构建监听；任一子进程退出时清理整套服务，不自动换端口。重载父进程持续持有数据锁，每个 worker 导入数据库前检查迁移。公网不暴露 Vite，由网关经隧道转发并读取与本机相同的静态构建。`capabilities/web_access/` 拥有公网监听器与专用 SSH 生命周期；附加 lifespan 关闭。本机管理权限依据实际 socket，不信任客户端 hostname 或转发头。公网管理员也不得管理主机目录、Codex、磁盘或访问配置；相关菜单只在本机入口显示。
- 网站静态资源通过 `build:studio` 构建清单、哈希与压缩文件；云端仅托管程序。`/v1`、私人素材、SSE 不进入共享缓存，HTML 回退不覆盖未知 API 和缺失资源。公网启动要求构建匹配。
- Amadeus 新对话由已登记的 Codex、Claude Code、OpenCode、DeepSeek Harness 或 Pi CLI 执行；FPL 后端持有运行、事件、审批和恢复，CLI 仅获得任务工具授权，不继承个人工具或通用 Shell。连接部署配置归 TOML，由可信本机管理员启用；有效账号可在有权访问的功能中使用已启用的连接。固定业务任务共用连接注册表并保留自有任务边界，云控仍仅管理员可访问。外部 CLI 的模型和认证配置按白名单读取，执行配置、插件和工具目录不直接继承。
- CLI/SDK/MCP 使用网站地址和 Management API Key。`studio/contracts/gateway/automation_operations.json` 维护业务白名单，`/v1/automation` 提供能力发现与有归属校验的资源链接；不控制浏览器标签页，不开放账号治理、密钥管理或任意系统命令。客户端凭据目录 0700、文件 0600，不通过参数或日志传递密钥。
- Amadeus 使用当前页面侧栏和显式账号上下文接口，不依赖原生窗口或 IPC。下载与演示窗口使用浏览器能力，并保留弹窗阻止反馈和未保存保护。
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
- 模型与供应商差异在 `backend/studio/apps/model_service/providers/` 的适配边界内归一化。公共 REST/SSE、模型
  测试和调用日志契约保持供应商无关；供应商管理页面可以展示配置，但前端运行流程不得依赖
  供应商原始事件。
- 图片/视频后台任务的状态转换由 `studio/apps/model_service/generation/driver.GenerationTaskDriver` 唯一编排；各功能
  只提供任务存取、素材组装/落盘和调用日志钩子。`submitting` 中断必须安全失败，禁止自动重提。
- 确定性时间线画面与视频渲染由 `backend/app/capabilities/media_rendering/` 统一拥有；Galgame 直接导出不得
  依赖 `video_editor/` 实现，只有显式的视频编辑器交接用例可以跨功能调用。
- ORM 的 ID/时间默认工厂由 `studio/runtime/ids.py` 与 `studio/runtime/time.py` 维护；各包 ORM 模型只依赖
  `studio.runtime.database.orm_base` 与上述工厂。生产 Python 包不得形成强依赖环。账号项目记录的加载、CAS
  更新和删除原语可复用 `runtime/project_records.py`，但事务、默认文档、快照和领域规则必须留在所属功能包。
  编辑批处理回执与传输形状归属 `studio/runtime/database/project_operations.py`、`studio/runtime/operation_batches.py`。
- Story 总校验保持纯函数分层：身份/角色、素材、国际化、时间轴、流程与表现层规则归属
  `apps/galgame_workshop/schemas/story_validation.py`；Pydantic Story 入口只负责迁移适配和统一调用。
- 身份契约归属 `studio/contracts/identity/`；账号、Session、审计、Management API Key 与注册归属
  `studio/apps/identity/`。跨应用不加载账号 ORM；兼容网站的模型初始化由装配绑定。仅有 `admin` 和 `user` 两种平台角色。管理员不具有其他账号私人数据的读取权。
  `StudioPrincipal.user_id` 是私人数据唯一归属来源，`owner_user_id` 与它相同；业务请求不得接受客户端指定归属。
  路由通过 `OwnerDep` 传递账号，根资源保存 `owner_user_id`，子资源继承已经校验的根资源归属。
  不存在 Workspace、成员角色、动态权限矩阵、账号切换空间或 `default` 回退；后台执行器从持久任务恢复账号。
  `AssetStorage` 的项目路径与写入方法必须显式传入账号；跨账号 ID 按不存在处理。
  HTTP `UploadFile` 只在路由中出现，业务用例依赖 `studio.contracts.asset_library.incoming.IncomingFile`。
  素材描述、媒体请求、时间线与特效文档归各所有者的 `studio/contracts/`；导入契约不得加载
  素材 ORM、文件适配或渲染器。接收流的 I/O 适配器负责成功、失败及取消后的关闭。
- 媒体裁切、格式读取、预览、缩略图和取帧共用 `studio/apps/media_rendering/use_cases/read_media.py`；用例只接收
  素材借用、执行与授权端口。素材存储关闭查询事务后才借出内容，完成处理后重新验证身份。
  文件路径限定在 I/O 适配内，借用句柄不能存入任务、缓存或响应。
  派生输出使用独立句柄，来源释放不影响输出；授权失败和 HTTP 响应中断均须清理临时输出。
- 思绪工坊 `publication/` 拥有发布与逐篇授权，社区接口仅使用浏览器 Session；先验证发布记录、当前文章与有效角色，再在独立会话中显式绑定源账号。素材仅开放可读正文实际引用的文件与发布封面；不开放历史、私人目录或普通文件库查询。正文仍由 Notes 用例执行校验、CAS 和历史，回收站事务同步撤回发布，恢复不自动重新发布。
- 固定账号权限由 `studio/contracts/identity/permissions.py` 维护，业务 HTTP/SSE 操作必须登记在
  `studio/contracts/identity/route_permissions.py`；架构测试禁止未登记路由。Web 统一消费 Principal 的有效权限，
  只读浏览页面由各功能模块拥有，账号查询键由 `features/accounts/queryKeys.ts` 唯一维护。
- 模型模板同步、运行额度和演示配置属于 `studio/apps/model_service/`；兼容网站按已登记设置键
  读写原表，不转移存储归属。演示执行组件不依赖账号治理或模型目录，由装配注入配置读取。
- Web 不保存密码、Session、CSRF 或 Management API Key 明文；Session 只使用 HttpOnly Cookie，
  写请求统一携带可读 CSRF Cookie 对应的请求头。API Key 明文和临时密码只允许展示一次。
- 修改安装、启动、环境变量、依赖或目录路径时，同步检查根与 Web 的 `package.json`、
  `pyproject.toml`、脚本、README 和 CI/测试入口。
- `scripts/demo/` 只保存内容专用演示维护工具；必须通过正式 API 操作，并要求调用者显式提供项目 ID、
  素材根目录和输入/输出路径，不得保存本机绝对路径或默认目标项目。

- 「云控」是仅管理员可访问的一级功能，入口为 `/cloud-control`，工作台入口为 `/agents`。业务 API、SSE 和后台采集叠加 `cloud-control.access`；普通账号已有副本保留且不转移归属。云控的公网远程桌面和工作台项目执行独立显式启用，并要求账号授权与密码重验、TOTP。远程桌面仅转接预设 Mac 屏幕共享，项目执行仅访问 TOML 授权的项目与命令预设。当前网站保留兼容装配，独立服务实现由服务化分支按既定门禁统一切换，不另建云控服务。

## SDK 与文档契约

- Python SDK 位于 `sdk/python/`，不依赖后端运行时。`generated/` 由 OpenAPI 和 `operations.json` 生成，不手工编辑。
- 修改公共接口后运行 `npm run contracts:generate`，同时更新 SDK 与文档参考；`npm run sdk:check` 检查生成物。具名方法覆盖不等于业务闭环测试。
- 独立模型任务归属 `studio/apps/model_service/inference/`；备份账号时一并保留 `model-inference/inputs/`、`model-inference/outputs/`。提交中断禁止重新提交供应商。

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
- `db/migrations/` 是唯一 schema 迁移入口。已登记迁移的 ID、顺序和 SQL 不得改写；修复或
  扩展只能在 `versions/` 追加新版本并更新 `registry.py`。
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
- 真正约束体量的是目录预算：`web/src/apps|console` 、`backend/studio/` 与 `backend/app/console|capabilities`
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
