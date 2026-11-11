# Studio 框架契约

修改应用注册、网站或独立服务装配、跨应用交接、账号数据边界或共享执行机制时遵守本文。目录和实现归属见[项目目录索引](project-layout.md)。

## 产品范围

Future Props Lab 是单机部署的模型基础设施管理台。单机可运行独立应用服务，每服务使用自有 SQLite，私人数据按账号隔离。
浏览器是交互入口，CLI、SDK 和 MCP 走受限自动化接口。实时语音仅用于模型测试。产品范围排除 Bot、模型检索知识库（RAG）、
电话接入、浏览器扩展和多实例部署。

## 后端应用与装配

- 原 `fpl_*` 包和 `backend/app/` 源码已迁入 `backend/studio/`，禁止重建旧目录或兼容转发包。
  `apps/` 拥有业务，`contracts/` 按所有者保存纯协议，`runtime/` 拥有无业务归属机制，
  `assembly/independent/<owner>/` 拥有服务构造、CLI 和维护装配；主机入口在 `assembly/host/`。
- `studio/assembly/website/` 显式构造兼容网站。`application` 创建实例，`bindings` 注入组件，
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
- 迁移代码路径时同步检查入口、镜像闭包、打包、契约归属和测试。禁止用空目录、软链接或永久转发表示迁移完成。
- 由入口装配显式提供应用的配置、账号范围存储、凭据能力和外部客户端。依赖从构造器、请求或用例端口传入，
  禁止以 Session、整个应用状态容器或进程全局设置查找业务依赖。装配拥有实例生命周期，关闭时回收资源。
- 所有路由与协议适配只校验请求、调用功能模块并把领域结果或错误映射为协议响应。
  禁止直接导入 SQLAlchemy、ORM 模型或 `db.migrations`。查询、写入和事务规则归所属业务及其存储适配。
- 不新增 `services/`、`domain/`、`platform/`、`product/` 等通用后端抽象层目录。需要拆分时，
  在所属能力内按具体职责命名文件或子包，例如 `studio/apps/model_service/catalog/`、`studio/apps/asset_library/storage/`。

## 工坊注册与 Web 边界

- 工坊在 `web/src/app/applicationRegistry.ts` 注册，业务模块、页面和项目行为归 `web/src/features/<owner>/`。
  新增路由、独立 HTML 入口与适配验收见[开发与验证流程](../operations/development-workflow.md)。
- Web 保持 `app/ + features/ + shared/ + platform/ + generated/`。`app/` 负责入口、共用应用壳与路由，
  `features/` 拥有业务页面和用例，`shared/` 放无业务归属的复用 UI，`platform/` 放 API 与认证
  基础设施，`generated/` 只保存生成契约。
- Web 的 `app/routing/` 负责页面组合与浏览器导航控制器，`app/layout/` 保留展示壳；
  兼容网站的 `SignedInApp` 唯一创建 `useWebsiteNavigation` 并传给路由组合。
  未保存拦截、历史回退和 Agent 导航共用此实例，生命周期结束必须移除监听。
  URL 类型与解析契约继续由 `app/routes.ts` 拥有，不将导航控制器放入业务 feature。
- 浏览器启动入口归 `app/entries/`；兼容网站先通过 `website-bootstrap.ts` 建立加载失败反馈，
  再加载 `website.tsx` 的 React 装配。通用 UI 与浏览器 API 测试分别归 `web/tests/shared/` 与 `web/tests/platform/`。
- Web 的 `platform/` 与 `shared/` 不得依赖 `features/` 或 `app/`，`features/` 不得依赖
  `app/`；业务代码不得堆回 `web/src/` 根目录。生产请求通过 OpenAPI 生成类型访问后端，
  `generated/` 文件不得手工编辑。
- Models、Visual Workshop、Thought Workshop、Presentation Workshop、Audio Annotation 与 Integration Center 的 TanStack Query 键由各自 `queryKeys.ts` 唯一
  维护；跨功能消费者导入 owner 的 key factory，不得复制同名缓存键。鉴权文件预览统一使用
  `platform/api/useApiBlobUrl.ts` 管理取消、竞态和 Object URL 回收；自有缓存或多音轨播放器除外。
- Web 工坊之间默认独立。跨工坊交接仅允许架构测试中 `ALLOWED_APP_HANDOFFS` 登记的方向，并通过目标工坊的公共入口。
  当前登记视频剪辑向视觉创作工坊的片段交接、特效制作向视频剪辑工坊的成片交接。见[架构测试](../../tests/architecture/test_repository.py)。

## 身份与公共接口

- 业务 API 统一注册在 `/v1`；只有 `/health` 与 `/ready` 作为根级探针。
- 身份契约归属 `studio/contracts/identity/`；账号、Session、审计、Management API Key 与注册归属
  `studio/apps/identity/`。跨应用不加载账号 ORM；兼容网站的模型初始化由装配绑定。仅有 `admin` 和 `user` 两种平台角色。管理员不具有其他账号私人数据的读取权。
  `StudioPrincipal.user_id` 是私人数据唯一归属来源，`owner_user_id` 与它相同；业务请求不得接受客户端指定归属。
  路由通过 `OwnerDep` 传递账号，根资源保存 `owner_user_id`，子资源继承已经校验的根资源归属。
  不存在 Workspace、成员角色、动态权限矩阵、账号切换空间或 `default` 回退；后台执行器从持久任务恢复账号。
  `AssetStorage` 的项目路径与写入方法必须显式传入账号；跨账号 ID 按不存在处理。
  HTTP `UploadFile` 只在路由中出现，业务用例依赖 `studio.contracts.asset_library.incoming.IncomingFile`。
  素材描述、媒体请求、时间线与特效文档归各所有者的 `studio/contracts/`；导入契约不得加载
  素材 ORM、文件适配或渲染器。接收流的 I/O 适配器负责成功、失败及取消后的关闭。
- 邀请码创建与查看由 Identity 装配显式提供加密与解密能力。
- 固定账号权限由 `studio/contracts/identity/permissions.py` 维护，业务 HTTP/SSE 操作必须登记在
  `studio/contracts/identity/route_permissions.py`；架构测试禁止未登记路由。Web 统一消费 Principal 的有效权限，
  只读浏览页面由各功能模块拥有，账号查询键由 `features/accounts/queryKeys.ts` 唯一维护。
- Web 不保存密码、Session、CSRF 或 Management API Key 明文；Session 只使用 HttpOnly Cookie，
  写请求统一携带可读 CSRF Cookie 对应的请求头。临时密码只允许展示一次。有效的 Management API Key
  允许签发账号在浏览器 Session 通过近期密码验证后取回加密副本对应的明文，禁止缓存取回响应。
- CLI/SDK/MCP 使用网站地址和 Management API Key。`studio/contracts/gateway/automation_operations.json` 维护业务白名单，`/v1/automation` 提供能力发现与有归属校验的资源链接；不控制浏览器标签页，不开放账号治理、密钥管理或任意系统命令。客户端凭据目录 0700、文件 0600，不通过参数或日志传递密钥。

## 数据与事务

- SQLite 连接启用外键、WAL 和忙等待。各服务数据由自身应用所有。运行期数据的创建、更新、删除、修复、
  导入、回填与管理经正式 `/v1` API 完成，统一使用所属应用的业务校验、事务、并发控制和错误映射。
  存储层与迁移测试可以在各自创建的隔离库中直接构造测试状态。正式迁移与备份见[生产部署](../operations/production-deployment.md)。
- `AsyncSession` 是单任务资源，不得由并行分支共享。外部模型请求、网络等待或大文件 I/O
  不得放在已经开始写入的长事务中；流式生成应使用独立短事务准备和结算状态。
- 整体 JSON、配置和会话等 revisioned 资源使用数据库 CAS。缺少 revision 返回 422，冲突
  返回 409 与当前快照，客户端不得静默覆盖。
- ORM 的 ID/时间默认工厂由 `studio/runtime/ids.py` 与 `studio/runtime/time.py` 维护；各包 ORM 模型只依赖
  `studio.runtime.database.orm_base` 与上述工厂。生产 Python 包不得形成强依赖环。账号项目记录的加载、CAS
  更新和删除原语可复用 `runtime/project_records.py`，但事务、默认文档、快照和领域规则必须留在所属功能包。
  编辑批处理回执与传输形状归属 `studio/runtime/database/project_operations.py`、`studio/runtime/operation_batches.py`。
- 原平台设置表的通用记录和 CAS 机制在 `studio/runtime/database/settings_*`；键归属由
  `studio/contracts/management/setting_owners.py` 登记，应用存储适配限定可访问分区。
  原语不自行提交，授权、业务写入和审计仍在调用者完整事务内；模板加密器由两种装配显式传入。
- 对可能已经提交的操作，先查询持久记录或回执确认结果，再决定重试或补偿。文件与数据库的协作见[文件暂存与数据库事务](../operations/file-transactions.md)。

## 共享执行与文件机制

- 模型与供应商差异在 `backend/studio/apps/model_service/providers/` 的适配边界内归一化。公共 REST/SSE、模型
  测试和调用日志契约保持供应商无关；供应商管理页面可以展示配置，但前端运行流程不得依赖
  供应商原始事件。

- 图片/视频后台任务的状态转换由 `studio/apps/model_service/generation/driver.GenerationTaskDriver` 唯一编排；各功能
  只提供任务存取、素材组装/落盘和调用日志钩子。`submitting` 中断必须安全失败，禁止自动重提。

- 通用工具循环、上下文预算和进程内审批等待归 `studio/runtime/tasks/reactive_tools/`。
  循环必须接收审批端口；应用装配创建并在关闭时清理协调器，不在模块导入时创建单例。
  持久审批、业务授权、最终状态和重启恢复仍由所属应用负责，通用循环不得代为裁决。

- 栅格缩略图只使用 `runtime/files/raster.py` 的有界解码器；实例与并发额度由应用装配持有，
  不在模块导入时创建全局实例或信号量。素材缓存路径与协议错误归所属应用；重复取消必须等待
  解码线程结束再释放额度。头像读写与启动清理显式接收配置，不读取全局设置。

- 媒体本地适配通过 `studio/deployment/media_modules.py` 逐模块登记可打包范围，不开放媒体存储或用例；
  预览并发由装配实例持有，禁止模块全局信号量。
- 确定性时间线画面与视频渲染由 `backend/studio/apps/media_rendering/local/` 统一拥有；Galgame 直接导出不得
  依赖 `video_editor/` 实现，只有显式的视频编辑器交接用例可以跨功能调用。

- 媒体裁切、格式读取、预览、缩略图和取帧共用 `studio/apps/media_rendering/use_cases/read_media.py`；用例只接收
  素材借用、执行与授权端口。素材存储关闭查询事务后才借出内容，完成处理后重新验证身份。
  文件路径限定在 I/O 适配内，借用句柄不能存入任务、缓存或响应。
  派生输出使用独立句柄，来源释放不影响输出；授权失败和 HTTP 响应中断均须清理临时输出。
