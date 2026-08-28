# AGENTS.md

## 开始前

- 每次正式处理仓库任务前先阅读本文件；所有命令默认在仓库根目录执行。
- 本项目定位为单机部署的模型基础设施管理台，支持同一进程和同一 SQLite 内的多账号与逻辑多
  Workspace 隔离；实时语音仅用于模型测试，不引入 Bot、知识库、电话接入、浏览器扩展或多实例部署能力。
- 目录职责以 [`docs/architecture/project-layout.md`](docs/architecture/project-layout.md)
  为唯一完整索引；新增目录或改变职责时同步更新该文件。
- Python 命令与临时诊断优先通过 `uv run` 执行。
- 仓库二进制资产使用 Git LFS；缺少对象时先按路径选择性 `git lfs pull`，不得把 LFS 指针当作字体、
  模型或图片内容处理。
- 后端环境变量只放在 `backend/.env`，不得提交真实密钥或把密钥写入日志、测试快照与文档。

## 常用命令

- 安装后端与 Web 依赖：`npm run setup`。
- 一键启动后端与 Web：`npm run dev`；单独启动使用 `npm run dev:backend`、
  `npm run dev:web`。
- 数据库迁移：`npm run db:migrate`；只检查迁移状态：`npm run db:migrate:check`。
- OpenAPI 生成与 stale-check：`npm run contracts:generate`、`npm run contracts:check`。
- 测试：`npm test`；浏览器端到端测试：`npm run test:e2e`。
- 质量检查：`npm run lint`、`npm run format:check`、`npm run build`；需要自动格式化时使用
  `npm run format`。
- Git LFS：`npm run lfs:check:pointers` 检查指针，`npm run lfs:check` 检查生产运行资产。

## 应用与目录边界

- `backend/app/` 采用功能模块优先结构。`main.py`、`deps.py`、`problem_details.py` 与
  `routes/` 只负责应用装配和 HTTP/SSE 协议边界；`core/`、`concurrency/` 是基础设施；
  `models/`、`schemas/` 只定义持久化与传输形状；公共文件规则归属 `files/`，业务规则归属
  `llm/`、`visual_workshop/` 等具体功能包。
- 路由模块不得直接导入 SQLAlchemy、ORM 模型或 `db.migrations`，不得自行持有查询、写入和
  事务规则。它们只校验请求、调用功能模块并把领域结果或错误映射为协议响应。
- 不新增 `services/`、`domain/`、`platform/`、`product/` 等通用后端抽象层目录。需要拆分时，
  在所属能力内按具体职责命名文件或子包，例如 `llm/catalog/`、`llm/playground/`。
- 业务 API 统一注册在 `/v1`；只有 `/health` 与 `/ready` 作为根级探针。
- Web 保持 `app/ + features/ + shared/ + platform/ + generated/`：`app/` 负责入口、壳与路由，
  `features/` 拥有业务页面和用例，`shared/` 放无业务归属的复用 UI，`platform/` 放 API 与认证
  基础设施，`generated/` 只保存生成契约。
- Web 的 `platform/` 与 `shared/` 不得依赖 `features/` 或 `app/`，`features/` 不得依赖
  `app/`；业务代码不得堆回 `web/src/` 根目录。生产请求通过 OpenAPI 生成类型访问后端，
  `generated/` 文件不得手工编辑。
- Models、Visual Workshop 与 Audio Annotation 的 TanStack Query 键由各自 `queryKeys.ts` 唯一
  维护；跨功能消费者导入 owner 的 key factory，不得复制同名缓存键。鉴权文件预览统一使用
  `platform/api/useApiBlobUrl.ts` 管理取消、竞态和 Object URL 回收；自有缓存或多音轨播放器除外。
- Web 中面向用户可见的交互控件不得直接暴露浏览器默认外观或原生弹层。下拉菜单、颜色选择、
  日期选择等必须使用项目自绘组件并适配明暗主题；原生 `select`、`input[type="color"]`、
  `input[type="date"]` 仅可作为完全隐藏的底层能力，不能作为最终可见 UI。新增或修改页面时应
  同步检查键盘操作、焦点状态与无障碍标签，避免因浏览器或操作系统不同出现不一致样式。
- 模型与供应商差异在 `backend/app/llm/providers/` 的适配边界内归一化。公共 REST/SSE、模型
  测试和调用日志契约保持供应商无关；供应商管理页面可以展示配置，但前端运行流程不得依赖
  供应商原始事件。
- 账号、Session、审计、Management API Key 与 Workspace 治理归属 `backend/app/accounts/`；
  `StudioPrincipal` 是业务请求的唯一租户来源，业务 API 不接受客户端提交 `workspace_id`。
  根资源必须直接保存 `workspace_id`，子资源通过已校验的根资源继承；跨 Workspace 的 ID 一律
  按不存在处理。后台执行器必须从任务记录恢复 Workspace，不能依赖请求上下文。
- Web 不保存密码、Session、CSRF 或 Management API Key 明文；Session 只使用 HttpOnly Cookie，
  写请求统一携带可读 CSRF Cookie 对应的请求头。API Key 明文和临时密码只允许展示一次。
- 修改安装、启动、环境变量、依赖或目录路径时，同步检查根与 Web 的 `package.json`、
  `pyproject.toml`、脚本、README 和 CI/测试入口。
- `scripts/demo/` 只保存内容专用演示维护工具；必须通过正式 API 操作，并要求调用者显式提供项目 ID、
  素材根目录和输入/输出路径，不得保存本机绝对路径或默认目标项目。

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
  `accounts/` 中与 HTTP 共用的正式用例，不得执行裸 SQL；首个管理员负责认领 `default` Workspace。
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
- 备份数据库前先停止应用，并同时复制 SQLite 主文件、`workspaces/`、`profiles/`、
  `library/assets/`、`applications/` 与 `model-test/attachments/`、`model-test/references/`、
  `model-test/generated/`；不要把
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
- 生产 Python 单文件上限 700 行、TS/TSX 上限 800 行、CSS 上限 600 行，测试文件上限 1200 行；
  OpenAPI 等生成文件排除。历史超限基线只能下降不能增长，不得新增编号式 CSS 分片；构建预算脚本
  只读产物，不得在构建后拆分或改写 CSS。
- 修复问题时先定位根因和同类风险；保留用户已有的未提交改动，不覆盖或顺手重写无关文件。
- 新增或替换 `docs/` 图片、固定字体或 VAD 二进制时同步更新 `docs/assets/MANIFEST.md`，并执行
  `git lfs fsck`；未核清来源和许可证的演示素材不得视为可再分发资产。
