# 项目目录索引

这是 Future Props Lab 目录职责的唯一完整索引。新增、删除目录或改变目录职责时更新本文件；
各模块文档只补充局部使用方法，不另行定义一套架构。

```text
Future-Props-Lab/
├── backend/app/
│   ├── main.py        # FastAPI 装配、生命周期与健康探针
│   ├── deps.py        # 请求级会话和 Studio 鉴权依赖
│   ├── problem_details.py # 统一协议错误映射
│   ├── concurrency/   # revision/CAS 并发语义
│   ├── core/          # 配置、数据库、时间与密钥基础设施
│   ├── files/         # 公共文件、文件夹、存储校验与项目文件引用
│   ├── agents/        # 供应商无关 Agent Harness、Reactive 工具循环与内存审批
│   ├── llm/           # 模型目录、供应商适配、共享生成运行时、测试工作台和调用日志
│   ├── tool_navigation/ # 工具收藏与最近使用状态规则
│   ├── visual_workshop/ # 视觉工坊项目、画布、助手、生成任务与领域适配器
│   ├── galgame_workshop/ # Galgame 工程、V1 故事 CAS、私有素材引用与线路分析
│   ├── models/        # SQLAlchemy 持久化形状
│   ├── routes/        # `/v1` HTTP/SSE 协议边界
│   └── schemas/       # Pydantic 请求与响应形状
├── db/migrations/
│   ├── versions/      # 只追加、不可改写的 SQLite migration
│   ├── registry.py    # 有序 migration 注册表与最新版本
│   └── runner.py      # checksum、连续前缀检查和事务应用
├── web/src/
│   ├── app/           # Studio 入口、壳与路由
│   ├── docs/          # 独立空文档中心入口
│   ├── features/      # 首页、AI 应用、文件管理、视觉工坊、Galgame 工坊、工具导航与模型功能
│   ├── generated/     # OpenAPI 生成物
│   ├── platform/      # API 与管理令牌基础设施
│   └── shared/        # 品牌与主题 UI
├── web/tests/         # Web 组件测试
├── web/e2e/           # Playwright 浏览器旅程
├── tests/             # 后端单元、API、存储与架构测试
└── scripts/           # OpenAPI 契约导出
```

## 目录与依赖边界

- 后端采用功能模块优先结构。`main.py` 负责装配，`routes/` 只负责认证、请求校验、调用功能
  边界和响应映射，不直接导入 SQLAlchemy、ORM 模型或 migration。查询、写入和事务由
  `llm/catalog/`、`llm/playground/`、`llm/call_logs/` 等所属能力负责。
- `agents/harness/` 提供业务无关的 Agent Definition、上下文预算、Reactive 工具循环、Policy、
  Verifier、事件订阅、取消和内存审批；不拥有项目数据，也不提供通用 `/v1/agents` 管理接口。
  `llm/providers/` 是供应商协议差异的唯一实现边界。模型测试、诊断、REST/SSE 与 Web 消费端
  只依赖统一结果或事件，不根据供应商原始载荷控制运行行为；供应商管理界面展示配置属于例外。
- 后端不增加通用 `services/`、`domain/`、`platform/` 或 `product/` 分层。需要拆分大型模块
  时，按具体业务能力在所属功能包内命名，避免同一职责出现多个事实源。
- 工具目录由 Web 静态注册表维护；后端 `tool_navigation/` 只持久化稳定工具 ID 对应的收藏与
  最近使用状态，不复制工具名称、分类或外部网址。
- AI 应用目录同样由 Web 静态注册表维护，应用最近访问记录只保存在浏览器本地。视觉创作工坊
  与 Galgame 工坊各自使用独立页面壳；后端 `files/` 负责公共文件元数据、文件夹、存储校验与项目引用，
  `visual_workshop/` 负责真实项目、revisioned 节点画布、项目对话与图片/视频异步生成任务，
  `galgame_workshop/` 负责 Galgame 工程元数据、V1 故事文档 CAS、角色立绘及场景背景素材生命周期与
  Fragment 线路分析，
  均不预置项目或素材。Studio 一级
  “文件管理”和项目素材浏览器复用同一文件 API；Galgame 上传故事图片也复用公共存储与内容签名校验，
  但只能通过 Galgame 工程素材 API 修改或删除。公共文件被视觉或 Galgame 工程引用期间禁止删除，
  对话消息引用的项目素材也必须先解除引用才能删除。
- Web 的依赖方向是 `app → features → shared/platform/generated`。`platform/` 与 `shared/`
  不依赖 `features/` 或 `app/`，`features/` 不依赖 `app/`；入口装配留在 `app/`，业务代码不
  放回 `web/src/` 根目录，生成契约不手工修改。
- 根 `/health`、`/ready` 是无版本探针，其他业务路由由统一的 `/v1` router 注册。

## 数据与运行边界

数据库是仓库根目录 `.runtime/future-props.db` 下的单机 SQLite 文件；文件管理内容保存在数据库
同级的 `visual-workshop/assets/`，模型测试对话图片保存在 `model-test/attachments/`，生成参考
素材保存在 `model-test/references/`，生成结果保存在 `model-test/generated/`，数据库与这些目录
共同构成本机数据真源。FastAPI 启动时自动创建
目录并执行 `registry.py` 中已登记、带 checksum 的 migration；每个连接启用外键约束、WAL
与忙等待。迁移历史只追加且不导入运行时 `app`，schema 变化必须同时更新 ORM、注册表、测试
和文档。

目录配置、模型测试会话与生成任务、视觉工坊项目、含节点级生成草稿的节点画布、项目对话、文件夹、文件和项目引用
使用 revision/CAS 防止静默覆盖；Galgame 工坊工程元数据与整份故事文档分别使用 revision/CAS，
故事冲突保留服务器完整快照，完成态工程在故事修改后恢复草稿；工具单项状态通过幂等更新和原子 upsert 写入。图片/视频生成任务持久化
供应商/模型快照和规范化参数，FastAPI 生命周期中的单机执行器负责恢复、轮询与安全下载；视觉工坊
和模型测试复用 `llm/generation_runtime/` 的轮询、并发与安全下载能力，但分别保存任务状态与
结果。`AsyncSession` 只能由单个异步任务
使用；每个生成分支使用独立短会话，供应商网络调用和文件下载不占用已开始写入的事务。
项目对话同样在发送准备与流式结算阶段使用独立短事务，并复用统一供应商适配边界。视觉工坊
Agent 是通用 Harness 的首个消费者：读取画布、素材和生成任务无需确认，画布写入和外部生成必须
经过内存审批；工具步骤持久化到对话消息，运行和审批等待不持久化，服务重启会安全取消遗留状态。
写工具复用视觉工坊校验与短事务，批量节点变更只执行一次画布 CAS，生成任务与占位节点原子创建，
且不与 `model_test_*` 数据混用。

模型测试对话、图片附件及生成结果是独立的单机调试数据，不进入视觉工坊文件管理，也不参与 Bot 或业务编排。当前工程也刻意不包含 Bot 会话、
知识库、实时语音、浏览器扩展、多租户和用户权限表。

## 按需扩展

Sayflow 的 PostgreSQL、多实例 worker、扩展、共享 runtime 包、知识库、评测仓和部署体系不属于
当前架构。只有出现至少两个真实消费者或明确交付需求时，才创建 `packages/`、`extension/`、
`evals/`、`deploy/` 等目录，并同时补充本索引、运行命令和架构测试。
