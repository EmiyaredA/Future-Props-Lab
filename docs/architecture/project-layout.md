# 项目目录索引

这是 Future Props Lab 目录职责的唯一完整索引。新增、删除目录或改变目录职责时更新本文件；
各模块文档只补充局部使用方法，不另行定义一套架构。

```text
Future-Props-Lab/
├── .github/workflows/ # 冻结依赖的 Python/Web 质量检查与 Chromium E2E
├── backend/app/
│   ├── main.py        # FastAPI 装配、生命周期与健康探针
│   ├── deps.py        # 请求级会话和 Studio 鉴权依赖
│   ├── problem_details.py # 统一协议错误映射
│   ├── accounts/      # 账号、Session、审计、API Key、Workspace 与公开投影
│   ├── concurrency/   # revision/CAS 并发语义
│   ├── core/          # 配置、数据库、时间与密钥基础设施
│   ├── files/         # 文件策略、落盘、公共库、项目引用与旧布局迁移
│   ├── agents/        # 供应商无关 Agent Harness、Reactive 工具循环与内存审批
│   ├── llm/           # 模型目录、供应商适配、共享生成/实时运行时、测试工作台和调用日志
│   ├── tool_navigation/ # 工具收藏与最近使用状态规则
│   ├── integrations/ # Workspace 工具 API、MCP、Skill 目录、验证与文件事务
│   ├── audio_annotation/ # Workspace 录音标注任务、文档/波形 CAS 与导入校验
│   ├── visual_workshop/ # 视觉工坊项目、画布、助手、生成任务与领域适配器
│   ├── galgame_workshop/ # Galgame 工程、Story 1.4 CAS、Story→RenderPlan 编译、剪辑交接、素材/ASR 与线路分析
│   ├── video_editor/ # API 驱动的多轨时间轴、代理/精确帧、RenderPlan 求值与 FFmpeg 后台合成
│   ├── models/        # SQLAlchemy 持久化形状
│   ├── routes/        # `/v1` HTTP/SSE 协议边界；Galgame 按五类协议模块汇总
│   └── schemas/       # Pydantic 请求与响应形状；Galgame 与视频剪辑按职责拆包
├── db/migrations/
│   ├── versions/      # 只追加、不可改写的 SQLite migration
│   ├── registry.py    # 有序 migration 注册表与最新版本
│   └── runner.py      # checksum、连续前缀检查和事务应用
├── web/src/
│   ├── app/           # Studio 入口、壳、路由与唯一 AI 应用注册表
│   ├── docs/          # 数据驱动的双工坊使用指南、搜索、目录与深链接
│   ├── features/      # 首页、AI 应用、文件管理、工坊、工具导航、集成中心与模型功能
│   ├── generated/     # OpenAPI 生成物
│   ├── platform/      # Cookie/CSRF、API 客户端、认证事件与浏览器语音基础设施
│   └── shared/        # 品牌与主题 UI
├── web/scripts/       # Web 构建与维护脚本；正式视频导出不在这里执行
├── web/public/docs/   # 文档中心使用的当前真实界面截图
├── web/tests/         # Web 组件测试
├── web/e2e/           # Playwright 浏览器旅程
│   └── fixtures/      # 人物旅程的确定性 API mock 与测试数据；真实烟测不使用
├── tests/             # 后端单元、API、存储与架构测试
├── scripts/           # OpenAPI 导出、API 导入客户端、离线账号命令与 E2E 账号引导
├── docs/operations/   # 故障排查、备份与恢复说明
├── CONTRIBUTING.md    # 开发流程、边界、测试矩阵与交付检查表
├── CHANGELOG.md       # 交付批次的用户可见变化与工程治理记录
├── .runtime/          # 本机 SQLite 与运行期素材（已忽略，不提交）
├── .scratch/          # 本地临时分镜、场景图与工作草稿（已忽略，不提交）
├── output/            # 本地导出结果（已忽略，不提交）
└── tmp/               # 本地临时处理目录（已忽略，不提交）
```

## 目录与依赖边界

- 后端采用功能模块优先结构。`main.py` 负责装配，`routes/` 只负责认证、请求校验、调用功能
  边界和响应映射，不直接导入 SQLAlchemy、ORM 模型或 migration。查询、写入和事务由
  `llm/catalog/`、`llm/playground/`、`llm/call_logs/` 等所属能力负责。
- `accounts/provisioning.py` 是 HTTP 管理接口和离线账号命令共用的账号开通用例；账号、Workspace、
  Owner 成员关系、审计事件与新 Workspace 模型目录在同一事务内提交或回滚。`accounts/service.py`
  不依赖模型目录实现。
- `agents/harness/` 提供业务无关的 Agent Definition、消息/工具调用/Usage/适配器契约、上下文预算、
  Reactive 工具循环、Policy、Verifier、事件订阅、取消和内存审批；不拥有项目数据，也不提供通用
  `/v1/agents` 管理接口。`llm/providers/` 是供应商协议差异的唯一实现边界，并反向实现 Harness
  定义的适配器契约。模型测试、诊断、REST/SSE 与 Web 消费端
  只依赖统一结果或事件，不根据供应商原始载荷控制运行行为；供应商管理界面展示配置属于例外。
- `llm/playground/` 拥有模型测试会话、测试工具、调用快照与流式结算。测试工具只执行 Workspace 内的
  确定性 Mock，不接入网络或外部系统；选择工具的文本会话复用 `agents/harness/`，未选择工具的会话
  继续使用原单轮流式路径。Web 的工具管理页面和对话工具控件归属 `features/models/tools/` 与
  `features/models/conversation/`，不把工具逻辑堆入应用壳或通用 UI。
- `llm/providers/realtime/` 只拥有供应商无关实时桥接契约与 SenseAudio 协议适配，
  `llm/realtime/` 负责 Workspace 模型解析、短会话日志结算和浏览器 WebSocket 编排；
  `web/src/platform/voice/` 负责 16 kHz 采集、Silero VAD、回声参考打断和 24 kHz 缓冲播放。
  这些模块不拥有 Bot、工具调用、知识库、电话或持久化实时会话。
- 后端不增加通用 `services/`、`domain/`、`platform/` 或 `product/` 分层。需要拆分大型模块
  时，按具体业务能力在所属功能包内命名，避免同一职责出现多个事实源。
- 工具目录由 Web 静态注册表维护；后端 `tool_navigation/` 只持久化稳定工具 ID 对应的收藏与
  最近使用状态，不复制工具名称、分类或外部网址。
- `integrations/` 拥有独立于工具导航的 Workspace 集成目录：`tool_apis/` 管理受限 HTTP 调用配置，
  `mcp/` 管理 Streamable HTTP/stdio 连接与工具快照，`skills/` 管理安全 ZIP 导入和不可变版本，
  `checks/` 只保存脱敏验证元数据。v1 只负责管理、发现和按需验证，不接入 Agent Harness 执行。
- `audio_annotation/` 管理 Workspace 级录音标注任务，根项目直接保存 `workspace_id` 并引用
  公共文件库中的音频；说话人/片段文档与最多双声道的预计算波形分别使用独立 revision CAS，
  选中片段可通过统一语音识别适配器执行一次性转写。识别参数、语言能力、文件上限和安全错误
  映射归属 `llm/transcription/`，录音标注、模型测试和 Galgame 只依赖该能力边界。
  删除任务不会删除原音频，被任务引用的音频不能从文件库删除。
- AI 应用目录同样由 Web 静态注册表维护，应用最近访问记录只保存在浏览器本地。视觉创作工坊
  、Galgame 工坊与视频剪辑工坊各自使用独立页面壳；后端 `files/` 负责公共文件元数据、文件夹、存储校验与项目引用，
  `visual_workshop/` 负责真实项目、revisioned 节点画布、项目对话与图片/视频异步生成任务，
  `galgame_workshop/` 负责 Galgame 工程元数据、Story 1.4 故事文档 CAS、Workspace 级旧 Story
  批量迁移与旧文件导入用例、剧情对话富文本、多人角色舞台演出、
  角色/多层场景/音视频素材生命周期、虚拟打包路径、语音识别任务、立绘尺寸快照恢复、Fragment 线路分析与
  只读 Story 快照驱动的视频导出与分层剪辑交接任务，
  `video_editor/` 负责与 Story 解耦的微秒级多轨文档、类型化原子操作、项目素材快照、代理媒体、
  后端精确停帧和固定帧网格的 FFmpeg/Pillow 合成。正式剪辑渲染只依赖不可变时间轴快照和原素材，
  不启动 Chromium、Playwright 或浏览器录屏；Pillow 只承担文字透明层和二维像素合成，音频 PTS
  与最终封装由 FFmpeg 统一处理。
  均不预置项目或素材。Studio 一级
  “文件管理”和项目素材浏览器复用同一文件 API；Galgame 上传图片、音视频与字体也复用公共存储、内容签名和媒体元数据校验，
  但只能通过 Galgame 工程素材 API 修改或删除。公共文件被视觉或 Galgame 工程引用期间禁止删除，
  对话消息引用的项目素材也必须先解除引用才能删除。
- Galgame 视频导出按 `video_export_planning.py` 路线/片段/试片纯规划、`video_compiler.py`
  冻结 Story 到共享 `RenderPlan` 的编译、`video_compiler_events.py` 的绝对时间状态归约、
  `video_compiler_support.py`/`video_actor_compiler.py` 的舞台、序列帧与组合动画投影、
  `video_lip_sync.py` 的离线音频包络和确定性口型事件，以及 `video_dialogue.py` 的对白图层生成，
  `video_export.py` 用例和 `video_export_runner.py`
  后台执行拆分。直接导出与 `video_handoff.py`/`video_handoff_runner.py` 创建的分层剪辑工程共用
  同一编译结果；中文对白使用随应用分发的固定 Noto CJK 字体，正式成片只经过后端像素合成与
  FFmpeg，不启动网页、Chromium 或实时播放器。
  广播剧导入由 `annotation_import.py` 负责预检和任务
  用例，`annotation_import_runner.py` 负责 FFmpeg 裁切、验收、保存与补偿。HTTP 路由不直接依赖
  Runner，应用生命周期只装配 Runner 模块。
- Galgame 素材写入和 CAS 用例保留在 `assets.py`；文件命名、媒体元数据映射等纯规则位于
  `asset_support.py`，引用分析、资源总览和打包清单位于 `asset_analysis.py`，避免 CRUD、Story
  遍历和打包投影继续共享一个大型类文件。
- 视觉助手对话生命周期与发送事务保留在 `visual_workshop/assistant/conversations.py`，附件权限、
  内容投影、图片编码和文档提取集中在同目录 `attachments.py`，避免会话持久化依赖具体媒体解析。
- Web 的依赖方向是 `app → features → shared/platform/generated`。`platform/` 与 `shared/`
  不依赖 `features/` 或 `app/`，`features/` 不依赖 `app/`；入口装配留在 `app/`，业务代码不
  放回 `web/src/` 根目录，生成契约不手工修改。
- Character Workspace 的 ViewModel 由独立 `characterWorkspaceViewModel.ts` 拥有，展示子面板不再
  反向导入总视图。Galgame 样式由 `galgameStyles.ts` 懒加载编辑器壳、Story 编排、角色舞台和
  素材/播放器四个语义包；源码在各语义所有者下继续按 foundation/components/interactions 拆分，
  不使用编号分片。构建预算只读产物，单 CSS 不超过 150 KiB、单懒加载 JS 不超过 500 KiB，
  Galgame CSS 总量以重构前 369,600 bytes 为基线至少降低 10% 并禁止回升。
- `web/src/docs/` 是独立文档入口的数据与展示边界，按页面和章节驱动视觉创作工坊、Galgame
  工坊指南，负责本地全文搜索、`docs.html?page=...#section` 深链接、响应式导航和主题；配套截图只
  存放于 `web/public/docs/`，不作为产品状态或测试数据源。
- `.github/workflows/` 使用锁文件安装依赖：后端验证 Python 3.11 与 3.14，Web 使用 Node.js 24，
  Chromium E2E 使用隔离临时数据库和确定性 fixture，不携带真实供应商凭证。
- 根 `/health`、`/ready` 是无版本探针，其他业务路由由统一的 `/v1` router 注册。
- `accounts/` 负责账号与 Workspace 用例；请求通过 Cookie Session 或绑定单一 Workspace 的
  Management API Key 生成 `StudioPrincipal`。业务模块只从 Principal 取得当前 Workspace，
  平台管理员切换到其他空间时也不会自动创建成员关系。

## 数据与运行边界

数据库是仓库根目录 `.runtime/future-props.db` 下的单机 SQLite 文件，也是项目状态唯一真源。
部署仍是单进程、单 SQLite，但账号之间按 `workspace_id` 做逻辑隔离。历史 `default` Workspace
继续读取原有目录；其他 Workspace 的新文件保存在
`workspaces/<workspace-id>/` 下，个人头像位于 `profiles/<user-id>/`。历史公共文件保存在
`library/assets/`；视觉项目使用
`applications/visual-workshop/projects/<project-id>/{assets,generated}/`；Galgame 项目使用
`applications/galgame-workshop/projects/<project-id>/{assets,derived,exports}/`；视频剪辑项目使用
`applications/video-editor/projects/<project-id>/{assets,derived,exports}/`。项目目录只保存素材、
派生文件和导出快照，标题变化不改变目录。模型测试对话图片保存在 `model-test/attachments/`，生成参考
素材及语音识别输入的任务私有副本保存在 `model-test/references/`，生成结果保存在 `model-test/generated/`。
Skill 不可变版本保存在 `workspaces/<workspace-id>/integrations/skills/<skill-id>/<version>/`。
本地临时分镜、场景图与未定稿草稿放在仓库根目录 `.scratch/`，与 `.runtime/`
一样被 git 忽略，不进入文档资产或产品素材真源。FastAPI 启动时自动创建
目录并执行 `registry.py` 中已登记、带 checksum 的 migration；每个连接启用外键约束、WAL
与忙等待。迁移历史只追加且不导入运行时 `app`，schema 变化必须同时更新 ORM、注册表、测试
和文档。`r0019_project_storage_layout` 只增加存储版本；旧文件由受鉴权的显式迁移 API 校验并搬迁，
schema migration 不执行文件 I/O。

目录配置、模型测试会话、测试工具与生成任务、视觉工坊项目、含节点级生成草稿的节点画布、项目对话、文件夹、文件和项目引用
使用 revision/CAS 防止静默覆盖；Galgame 工坊工程元数据与整份故事文档分别使用 revision/CAS，
故事冲突保留服务器完整快照，完成态工程在故事修改后恢复草稿。旧 Story 1.0–1.3 的格式转换只由
`schemas/galgame_workshop/story_legacy.py` 适配器拥有；`galgame_workshop/story_migrations.py`
通过正式 `/v1` API 执行状态预检、受 Workspace 约束的批量 CAS 固化和单工程旧文件导入，不以
schema migration 或直接数据库修改替代运行期迁移。工具单项状态通过幂等更新和原子 upsert 写入。图片/视频生成任务持久化
供应商/模型快照和规范化参数，FastAPI 生命周期中的单机执行器负责恢复、轮询与安全下载；视觉工坊
和模型测试复用 `llm/generation_runtime/` 的轮询、并发与安全下载能力，但分别保存任务状态与
结果。`AsyncSession` 只能由单个异步任务
使用；每个生成分支使用独立短会话，供应商网络调用和文件下载不占用已开始写入的事务。
项目对话同样在发送准备与流式结算阶段使用独立短事务，并复用统一供应商适配边界。视觉工坊
Agent 是通用 Harness 的首个消费者：读取画布、素材和生成任务无需确认，画布写入和外部生成必须
经过内存审批；工具步骤持久化到对话消息，运行和审批等待不持久化，服务重启会安全取消遗留状态。
写工具复用视觉工坊校验与短事务，批量节点变更只执行一次画布 CAS，生成任务与占位节点原子创建，
且不与 `model_test_*` 数据混用。

模型测试对话、测试工具、工具调用快照、图片附件及生成结果是独立的 Workspace 调试数据，不进入视觉
工坊文件管理，也不参与 Bot 或业务编排。测试工具均按无副作用 read 类型自动执行；启动恢复会把遗留
的 pending 模型回复和工具调用标记为 cancelled。`llm/call_logs/` 根据日志中已有的脱敏请求快照
按需生成不含凭证的临时复现 ZIP，不新增持久化副本；只有具备完整纯文本输入的供应商协议可导出。
实时语音通话不建立持久化会话，转写和音频只在浏览器与连接内存中存在，调用日志
仅保存时长、字符数、延迟、usage 与状态。当前工程包含单机账号和逻辑多 Workspace，但仍刻意不包含
Bot 会话、知识库、电话接入、浏览器扩展或多实例租户部署。

## 按需扩展

Sayflow 的 PostgreSQL、多实例 worker、扩展、共享 runtime 包、知识库、评测仓和部署体系不属于
当前架构。只有出现至少两个真实消费者或明确交付需求时，才创建 `packages/`、`extension/`、
`evals/`、`deploy/` 等目录，并同时补充本索引、运行命令和架构测试。
