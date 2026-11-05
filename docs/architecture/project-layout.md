# 项目目录索引

## Studio 组件归属迁移

所有原 `backend/fpl_*` 包已迁出，源码统一进入 `backend/studio/`。原 `backend/app/apps/` 的十个业务切片也已归并到对应应用。`backend/app/` 暂时保留兼容网站装配、模型/素材等尚未归并的实现；这部分和逐用例解耦仍属于后续迁移，不能把命名空间迁移视为整个方案验收完成。

已落地的目录骨架如下（以仓库根目录下为第一级，展开至第四级）：

```text
backend/
├── app/                          # 尚未归并的网站兼容实现
└── studio/
    ├── apps/
    │   ├── agent_workbench/
    │   ├── agent_runtime/
    │   ├── amadeus/
    │   ├── asset_library/
    │   ├── audio_annotation/
    │   ├── creative_workshop/
    │   ├── director_desk/
    │   ├── galgame_workshop/
    │   ├── gateway/
    │   ├── identity/
    │   ├── integrations/
    │   ├── interview_assistant/
    │   ├── management/
    │   ├── media_rendering/
    │   ├── model_service/
    │   ├── motion_compositor/
    │   ├── portal/
    │   ├── presentation_workshop/
    │   ├── remote_desktop/
    │   ├── thought_workshop/
    │   ├── tools/
    │   ├── video_editor/
    │   └── visual_workshop/
    ├── contracts/                # 按业务所有者命名的协议包
    ├── runtime/
    │   ├── database/
    │   ├── files/
    │   ├── http/
    │   ├── lifecycle/
    │   ├── messaging/
    │   └── tasks/
    ├── config/
    ├── host/
    │   ├── agent_execution/
    │   ├── deployment/
    │   ├── integrations/
    │   ├── local_models/
    │   ├── project_files/
    │   ├── remote_desktop/
    │   └── session_collection/
    ├── assembly/
    │   ├── host/
    │   └── independent/
    └── deployment/
```

- 应用内部 `storage/models.py` 保存共用业务模型，`storage/service_models.py` 保存独立服务附加模型，`storage/migrations/` 保存独立迁移链；迁移 SQL、ID 与顺序不变。协议适配位于 `transport/`，兼容站路由为 `transport/website/`，其余按实际业务操作命名。音频标注保留其已抽取的 `rules/`、`use_cases/` 和 `ports.py`。
- `assembly/independent/<应用名>/application.py` 构造服务，`cli.py` 提供启动/迁移命令，`maintenance.py` 提供存在该能力的回环维护装配。例如工作台通过 `python -m studio.assembly.independent.agent_workbench.cli` 启动；对外服务 ID 仍为 `agents`。
- `contracts/<所有者>/` 只保存可独立加载的数据形状、协议规则与固定权限；不导入业务实现、HTTP 框架或 ORM。账号权限清单在 `contracts/identity/route_permissions.py`，本地模型固定目录在 `config/local_models.json`。
- `runtime/database/` 拥有数据库连接、迁移执行、通用 ORM 原语和迁移传输适配；`http/` 拥有身份断言、错误映射、请求限制及静态资源适配；`tasks/` 拥有轮询和租约队列机制；`files/` 与 `messaging/` 拥有受限文件和签名载荷机制。业务状态裁决仍由应用负责。
- 所属应用的 `clients/` 可发布明确的跨进程客户端。镜像闭包只允许 `deployment/images.py` 显式登记的客户端模块及无副作用父包，继续逐个检查其依赖，不能因此带入该应用的存储或内部用例。
- `host/` 负责 Mac 本机动作，`assembly/host/` 构造主机运行环境；服务镜像禁止包含任何主机代码。普通业务不能通过客户端协议获得任意主机路径或执行权限。
- `config/` 拥有配置格式与转换，实际持久配置仍为 `backend/config.toml`。`deployment/` 拥有镜像源码闭包、路由/数据表归属清单与网关构建。打包只登记 `app`、`studio` 和 `db`，不保留旧命名空间转发包。

音频标注编辑数据流为 HTTP 请求 → 账号范围依赖装配 → `EditDocument` → 文档快照与纯规则 → `DocumentEdits.commit` → 同事务 CAS/回执 → 已提交响应。相同请求返回原回执，复用请求 ID 更改输入返回冲突，并发失败复查回执，取消回滚。素材、转录和暂存目录由入口显式注入，不经 Session 信息字典发现业务依赖。

剩余通用机制也已迁出旧 `app/runtime`：账号绑定、项目 CAS、操作回执及任务恢复查询归 `studio.runtime.database`，受限路径、归档成员及栅格处理归 `files`，静态网站和远程入口校验归 `http`，授权订阅归 `messaging`，任务准入原语归 `tasks`。设置类型与显式配置读取归 `studio.config.settings`；导入设置模块不读取 TOML、不加载数据库。旧网站数据库及隐式凭据装配仍需后续消除，不属于通用机制。

兼容网站的工作台采集与执行、Amadeus CLI 执行、面试准备、文章同步、视觉生成与验收、Galgame 媒体任务、视频剪辑及特效 Runner 显式接收会话工厂；需要配置的 Runner 同时接收配置值。工作台轮次继承所属 Runner 的工厂，不通过全局数据库寻找连接。HTTP 用例和剩余助手工具的逐项端口化仍在后续批次进行。

旧包映射如下；“已迁移”只表示该包源码与调用方迁移完成，兼容网站残余实现及整个业务的端口化另行验收。

| 旧包 | 当前归属 |
| --- | --- |
| `fpl_config` | `studio.config` |
| `fpl_deployment` | `studio.deployment` |
| `fpl_annotation` | `studio.apps.audio_annotation` 与对应装配 |
| `fpl_runtime` | 按所有者拆入 `contracts`、公开客户端、`runtime` 与 `assembly` |
| `fpl_agent_runtime` | `studio.apps.agent_runtime` |
| `fpl_agents` | `studio.apps.agent_workbench` |
| `fpl_amadeus` | `studio.apps.amadeus` |
| `fpl_assets` | `studio.apps.asset_library` |
| `fpl_creative` | `studio.apps.creative_workshop` |
| `fpl_director` | `studio.apps.director_desk` |
| `fpl_galgame` | `studio.apps.galgame_workshop` |
| `fpl_gateway` | `studio.apps.gateway` |
| `fpl_identity` | `studio.apps.identity` |
| `fpl_integrations` | `studio.apps.integrations` |
| `fpl_interview` | `studio.apps.interview_assistant` |
| `fpl_management` | `studio.apps.management` |
| `fpl_models` | `studio.apps.model_service` |
| `fpl_motion` | `studio.apps.motion_compositor` |
| `fpl_portal` | `studio.apps.portal` |
| `fpl_presentation` | `studio.apps.presentation_workshop` |
| `fpl_remote` | `studio.apps.remote_desktop` |
| `fpl_rendering` | `studio.apps.media_rendering` |
| `fpl_thought` | `studio.apps.thought_workshop` |
| `fpl_tools` | `studio.apps.tools` |
| `fpl_video` | `studio.apps.video_editor` |
| `fpl_visual` | `studio.apps.visual_workshop` |
| `fpl_host` | `studio.host` |

这是 Future Props Lab 目录职责的唯一完整索引。新增、删除目录或改变目录职责时更新本文件；
各模块文档只补充局部使用方法，不另行定义一套架构。

## Agent 工作台

执行切片以已授权项目对象接收账号目录和 TOML 预设。在 SQLite 写事务外完成目录检查，事务内复核归属、项目绑定和轮次状态。执行存储模块统一推进轮次、审批收据与 revision，SSE 取出快照后释放数据库会话再发送。文件工具与命令沙箱共用 `runtime/safe_paths.py` 的安全遍历与路径原语。项目选择器由工作台持有样式和焦点交互。 独立 Agents 复用 transcript 读取、恢复和版本查询，目录绑定保存到自身数据库，浏览和注册路由在 Mac 项目执行就绪前返回 503。

`capabilities/agents/cli/dialogue.py` 统一管理 CLI 分派、专用 profile、watchdog 和工具传输。工作台与 Amadeus 提供工具、事件回调及各自的运行上下文。Codex 对话就绪统一校验登录及隔离策略，模型目录的读取状态独立。

`backend/studio/apps/agent_workbench/` 拥有当前账号的来源绑定、只读会话投影、搜索、扫描回执和 SSE；`sync/` 在原生 I/O 结束后以短事务保存归一条目与检查点，并独立调度各来源。`backend/app/capabilities/agents/sessions/` 拥有五种原生格式、只读文件／SQLite／本机 OpenCode HTTP 适配和受限附件读取，不依赖工作台 ORM；`inline_images.py` 按块省略超大内嵌图片编码，检查点保持原始字节位置。`web/src/features/agent-workbench/` 拥有独立应用注册、三栏阅读、来源管理与账号缓存键。本机网站允许显式填写目录，实际 socket 标记用于新绑定校验。来源授权和执行授权独立。工作台的 `execution/` 拥有 FPL 创建的 CLI 会话、轮次、待执行队列、插入回执和项目审批；CLI 通信与 MCP 中继由 `capabilities/agents/cli/` 共用。API、存储与来源矩阵见 [`../reference/agent-workbench.md`](../reference/agent-workbench.md)。

## 浏览器加载与图片派生

`capabilities/asset_store/file_previews.py` 拥有文件预览授权、受限文本读取和账号／素材版本派生缓存；
`pdf_preview_worker.py` 在独立进程中读取 PDF 页数并栅格化当前页面，不执行文档脚本。
`capabilities/media_rendering/file_previews.py` 拥有有超时的媒体时长检查、视频封面和前 60 秒真实音频波形，
不接触账号或数据库。文件预览接口先完成归属校验并结束读取事务，再进行解码，缓存不能授予访问权。
`web/src/features/files/` 的 `FileThumbnail`、`FilePreviewDialog` 与 `FileMediaPlayer` 统一拥有列表缩略内容、
安全文档阅读和自绘播放控件；首页及只读文件入口复用这些公开组件，文件命名规则留在 `fileNames.ts`。
`FileLibraryActions` 拥有文件库导入、导出和本地目录菜单，动作由浏览器与页面显式传入；`styles/file-library.css` 将紧凑密度限定在文件管理页，不改变编辑器内嵌素材选择器。首页 `HomeResourceSection` 拥有独立折叠状态和标题栏操作插槽，文件上传及预览状态仍由 `HomeFiles` 持有。`HomeInfrastructure` 以等宽区域展示模型服务与编程智能体，智能体标识复用 `code-agents` 公开组件；首页只传递现有导航路径，不持有目录或连接状态。概览列表为静态说明，模型与智能体各保留一个管理入口。

`web/src/platform/api/transfer.ts` 拥有按请求隔离的流式接收、FormData 上传进度与取消；
`useTransferProgress` 将状态留在功能控制器，`useApiBlobUrl` 和 `useImagePreviewUrl` 分别管理鉴权文件生命周期和可见图片读取。
`shared/ui/LoadingState`、`ResponsiveImage`、`ImagePreview` 负责无业务归属的反馈与显示，不持有业务任务状态。
`shared/lib/imageSources` 负责预览 URL，`imageVariants.ts` 由脚本生成。

`shared/ui/LoadingScene` 拥有整页、区域与行内的同源琥珀仪表视觉；`LoadingCharacter` 拥有人物播放、暂停、静态回退及动态效果偏好，二者不持有业务状态。`web/public/brand/loading/` 保存仪表 SVG、八张道具 WebP、红莉栖小跑透明视频与首帧；二进制资产由 Git LFS 和生产资源 SHA-256 检查维护。`app/bootLoading.ts` 在 React 挂载前控制同源 HTML 加载场景并在成功或失败时清理。

`capabilities/asset_store/thumbnails.py` 拥有受限解码、方向校正、透明 WebP 与原子落盘；身份、社区和创作用例先授权后调用。
`scripts/generate_image_variants.py` 生成 `web/public/brand/thumbnails/` 下的摘要命名静态派生图和清单，构建执行过期检查。
接口、入口清单与验收约定见 [`../reference/loading-and-images.md`](../reference/loading-and-images.md)。

## 网站运行与自动化

### 独立服务迁移

`backend/fpl_runtime/` 是不导入业务 ORM 的服务运行契约，拥有 23 个发布单元、精确到 HTTP 方法和路径的归属匹配、请求绑定身份断言、独立 SQLite 会话与迁移校验。`backend/studio/deployment/` 从静态 OpenAPI 和模型源码生成 `deploy/contracts/ownership.json`，新增或重复操作及未归属表必须阻止构建。`npm run services:contracts:generate|check` 管理该清单，并纳入公共契约检查。跨服务 ORM 访问和缺少账号上下文的私人数据操作被存储边界拒绝。

`backend/studio/apps/gateway/` 拥有独立控制面、通知游标与自有迁移；`changes.py` 在同一事务记录发布方事件回执和账号游标，`notifications.py` 只接受配置的发布方，`routes.py` 通过明确客户端请求资源所属服务。`__main__.py` 在同一发布单元监督 Caddy 与控制面，Caddy 退出会停止控制面，关闭时回收代理子进程。Mac 公网管理桥接仍待接通。

`studio/contracts/identity/delegation.py` 限定调用方、来源操作、用途和目标地址；`capability_client.py` 使用原请求断言换取目标签名，不传递完整浏览器凭据。Identity 的 `delegation.py` 复核原账号会话并拒绝注销后的委托。`protocol_hash.py` 计算单服务公开操作及可达 schema 的契约哈希；`web.py` 核验程序清单、静态资源与对应服务契约，并阻止本应用旧页面写入。

`backend/studio/apps/identity/` 装配独立账号 ASGI 应用、账号事件、显式维护入口及自有 `migrations/`；不加载门户、工坊或模型 ORM。`console/governance/account_creation.py` 接受显式事务初始化回调，旧 `provisioning.py` 仅承担单体目录初始化适配；账号与注册路由使用装配时注入的用例。 `credential_migration.py` 拥有历史账号、Studio 会话和 Management API Key 批次，`avatar_migration.py` 与 `avatar_files.py` 校验并恢复原头像文件。
`studio/runtime/database/migration_apps.py` 装配独立回环维护进程，`scripts/website/migration_transfer.py` 负责传输与读回核验。

`backend/studio/apps/portal/` 装配独立门户与文档 API，仅拥有服务迁移标识，不持有账号或工坊数据，不启动其他 Runner。启动只读取经过分组校验的存储配置和 Identity 公钥；多余配置字段会拒绝，门户没有解密用途，不取得 FPL 加密密钥。开发者文档在构建时按现有允许列表封装，通过原浏览器 Session 与固定 `docs.developer` 权限读取；HTTP 路径、操作 ID、标签和 schema 保持兼容。

`web/src/app/entries/portal.tsx` 复用首页、应用目录和未改写的文档阅读器；`PortalDocuments.tsx` 只是装配入口。`features/applications/definitions.ts` 拥有纯目录元数据，各应用注册和门户共同消费，目录不导入其他应用页面。`programAsset` 定位首页动画与目录图标；原 `/docs/*` 截图地址只允许跳转到当前门户清单内的不可变程序资源。用户新确认的独立管理服务拥有管理页面和运行控制；账号持久数据仍归 Identity，通过接口治理，不能共享旧 SQLite。管理服务任务正在并行实现，接口对齐后纳入同仓库部署。

`backend/studio/apps/asset_library/` 拥有正在拆分的文件用例、素材保留集合、幂等回执与持久删除队列。`references.py` 为导入或核验已经提交的源快照提供归属、CAS 和素材校验，并记录不可变回执；正常资源修改使用下述独立准备意图。`files.py` 只访问自有文件、文件夹与项目文件引用位置，通过显式项目归属接口校验源项目；`deletions.py` 在数据库提交后逐文件清理，可在进程中断后恢复，不递归清空目录。`reference_changes.py` 为每次源修改单独记录准备意图及素材 pin；源数据库将修改与回执一起提交后才确认，只有已证实回滚才撤销。确认乱序只更新到较新的源版本，较新准备意图继续保留；未知结果不按时间清除。`0002_prepared_references` 追加独立表和永久删除标记，旧注册迁移不改写。`references.py` 的已提交快照导入不得覆盖正在准备的修改。

`studio/contracts/asset_library/retention_authority.py` 定义仅能准备和结算一次素材引用修改的签名授权，绑定调用服务、账号、请求 ID 与完整修改摘要；它不能作为公共 API、素材读取或任意后台任务凭据。Identity 的 `retention.py` / `retention_api.py` 从有效的原始业务写请求签发授权，并在新准备前重新检查账号与 Session/API Key。Assets 的 `retention_api.py` 只接受该授权，同一意图的结果确认可以在浏览器注销后完成；新准备拒绝失效或到期授权。`studio/apps/asset_library/clients/retention.py` 不自动改请求 ID、不跟随跳转，超时保留未决意图；源应用仍需将授权、修改与回执按其事务流程持久化。

`studio/apps/asset_library/project_links.py` 拥有文件库素材在 Visual 项目内的名称、文件夹位置及 CAS；`VisualProjectFileLink` 与追加迁移 `0003_project_file_links` 只引用 Assets 自有素材和文件夹，源项目 ID 不透明。删除项目素材文件夹在同一数据库级联移除这些位置记录，保留库中原件；删除被引用的原件会拒绝。现有 Visual 素材导入和引用 URL 由 Assets 承接，路径、操作 ID 和响应保持不变。旧单体的 `VisualProjectAssetReference` 仅用于兼容和封存导出。Assets 迁移保留 ID、目录与 revision，Visual 迁移在确认其独立库的兼容表为空后移除该表。内容预览、缩略图、媒体裁剪、取帧和媒体信息路径归 Rendering，本机打开文件夹归 Tools，账号、SDK 白名单与公开路径不变。

`layout.py` 仅整理自有旧格式文件，复制、大小及 SHA256 核验后通过 CAS 更新存储版本；不处理其他服务项目目录，不覆盖异内容目标，不删除源文件。中断可核验已经落盘的相同副本后完成登记。共享上传和 Assets 复制在数据库提交已经开始后遇到故障会保留文件，提交未知时不按回滚删除可能已提交的原件。

`backend/studio/apps/visual_workshop/asset_references/models.py` 现在拥有 Visual 项目引用 ORM，外部素材与文件夹 ID 不再声明跨服务外键。原 `asset_store.models` 名称只为旧单体显式导入保留兼容；Assets 通过 `asset_outputs.AssetReferenceView` 消费数据投影，不加载该 ORM。镜像闭包检查与全新进程验证共同阻止回归。

`settings.py` 只接受存储路径与三项文件限制，不加载 `.env` 或加密密钥。项目验证通过绑定原请求的 `assets.visual-project.read` 委托，只能从五个已登记文件操作读取 Visual 项目；不会传递原 Cookie 或完整客户端凭据。`application.py` 装配 21 个既有公开操作和私有引用协议，拥有文件清理生命周期；`__main__.py` 在加载 ORM 前解析最小配置、验证目录、取得独占锁并检查显式迁移。公开协议哈希与聚合契约一致。镜像与独立 `/files` 页面已经接通，完整容器验收和业务引用调用方仍是正式切换门禁。

`backend/studio/apps/presentation_workshop/` 装配独立演示文稿项目 API、迁移和持久引用结果。共享文稿用例在 `studio/apps/presentation_workshop/`，兼容装配注入原文件库，独立装配以 `studio/contracts/presentation_workshop/presentation_assets.py` 的签名契约向 Assets 读取素材描述和指定版本的 SVG。项目 CAS、编辑回执与素材引用结果在文稿服务的一次事务内提交。

`backend/studio/apps/motion_compositor/` 装配独立特效项目、文稿及编辑批次。业务规则仍在 `studio/apps/motion_compositor/`。独立编辑通过 `studio/contracts/motion_compositor/motion_assets.py` 的签名委托读取当前项目文件描述，Assets 单独持有文件。旧站通过显式文件布局端口保持兼容。

`backend/studio/apps/video_editor/` 装配独立视频剪辑项目和时间轴读取。项目事务复用 `studio/apps/video_editor/`，空项目只需要自有项目与时间轴记录，旧站的素材目录由显式兼容适配器维护。独立镜像不加载素材 ORM。

`backend/studio/apps/media_rendering/` 当前承接五个兼容媒体接口，不加载素材或工坊 ORM。`inputs.py` 通过受限的 `rendering.source.read` 委托读取同一素材的 HTTP 内容，以账号隔离的暂存目录接收并校验类型、revision、大小；Assets 内容响应显式声明这些描述头。`previews.py` 拥有有界缩略、裁剪、取帧及宫格输出，完成响应前再次验证账号授权；身份服务故障返回 503，撤销返回 401。它只挂载自己的状态目录和最小配置。`motion_jobs.py` 持有特效导出队列、已封存的原件与成片。Motion 持有公开任务、文档 CAS 和投递记录，两侧通过精确请求摘要和独立的控制凭据关联。剪辑交接与历史导出迁移仍属于整站切换门禁。

`backend/studio/apps/model_service/` 拥有独立模型服务的 HTTP、任务 Runner、目录初始化和持久化边界；`models.py` 显式列出默认选择和全部 Models 自有 ORM，`ACCOUNT_MODELS` 只标记拥有账号归属的根记录。`0001_account_defaults` 保持原样，追加的 `0002_model_capabilities` 创建目录、日志、模型测试／推理、本地模型与治理记录，不创建账号、素材或工坊表。账号、源素材和外部排队任务 ID 是不透明引用；仅保留自有表外键。旧单体数据库继续由原 SQL 迁移维护，已有外键与级联不因 ORM 的服务边界描述而被改写。`application.py` 与 `__main__.py` 装配自有 HTTP、配额、任务授权、模板同步、确定性演示和实时语音；独立页面与镜像可用于隔离验收。Mac 原生模型通过受认证租约与 worker 显式执行；当前九容器确定性验收通过，真实 Qwen 权重／MLX、其余应用服务和正式数据导入仍受切换门禁约束。

`studio/host/models_worker.py` 拥有执行回执、串行观测和停止屏障：等待真实动作清理与回执线程退出后才关闭资源、释放主机锁。`receipts.py` 仅为 Models 清除已确认 payload，保留摘要与结果防重复。`studio/apps/model_service/native_models.py` 的 `foreground_synthesis` 经 `llm/inference/runner.py` 的显式 `synthesis_scope` 覆盖完整前台提交／复制／finish，退出后后台才可使用原回执恢复，不重新合成。

`studio/apps/model_service/native_retention.py` 拥有原生交付副本清理；追加 `0012_native_result_retention` 保存退役和清理时间。持久应用确认后才清理副本；正式删除同事务擦除原生请求文本／签名证明和任务授权，保留原摘要及 worker／lease 校验迟到回执。`native_files.py` 在 `.tmp/native-model-uploads` 暂存，流结束后的短写事务重查持久栅栏才发布；已应用结果只返回原确认，不重建音频。失败留待启动／轮询重试，不按超时猜测未知提交。隔离故障测试与当前重建九容器验收通过，真实权重及正式转移仍未验证。

`studio/contracts/model_service/catalog_events.py` 定义仅含事件 ID、账号 ID、角色、版本和短期当前状态的私有目录初始化协议。`studio/apps/identity/catalog_events.py` 只允许独立 Models 凭据轮询／确认，拒绝浏览器和其他服务；历史事件与当前角色分开，停用账号保留事件但不投递。`studio/apps/model_service/account_events.py` 拥有有界 HTTP 传输与恢复轮询，`provisioning.py` 在独立账号事务中执行显式本地初始化回调并保存摘要回执。新增 `0003_catalog_provisioning` 不改写前两版。回执防止确认丢失后重建目录，不构成后续业务授权；完整 ASGI 装配仍待完成。

`llm/catalog/template_reconciliation.py` 拥有模板预览、保留 ID 的目录合并与默认选择规则；`template_values.py` 拥有输入密钥替换／保留及脱敏视图，不依赖治理存储。`studio/apps/model_service/templates.py` 使用追加的 `0004_role_templates` 自有角色策略表提供 CAS 与账号初始化，空策略沿用无密钥内置目录；调用方负责管理员授权和保存／审计事务。`task_usage.py` 只查询 Models 自有任务。恢复网站的旧设置、账号审计与跨工坊占用留在 `console/governance/model_templates.py` 适配器，独立服务不得导入它。

`studio/apps/model_service/quotas.py` 使用追加的 `0005_quota_policy` 保存独立 CAS 策略；协议类型归 `llm/schemas/runtime_quotas.py`，旧治理 schema 只作兼容导出。`admission.py` 持有同步调用与三个 Models 任务种类的额度生命周期：全局统计仅返回固定自有表的汇总，恢复任务没有账本也计入占用；任务关联与创建同事务，重放不可改绑。`llm/task_outcomes.py` 共享供应商提交中断结果标记，未知与缺失任务不会因超时被当作已完成。额度不等于执行授权；排队授权、Runner 结算与治理审计仍待完整装配。

`console/schemas/registration.py` 独立拥有注册／邀请码协议，`developer_documents.py` 拥有只读开发文档协议。Identity 和 Portal 直接使用各自协议文件，不能通过旧 `platform_governance.py` 聚合兼容导出间接加载模型模块。

`studio/apps/model_service/task_records.py` 明确自有任务种类与不可变输入摘要；`execution_authority.py` 使用追加的 `0006_task_authorizations` 将原始签名请求与任务创建同事务保存。出队前复核原始账号授权，事务内只检查短期决定与当前输入；缺失／失效来源拒绝提交，Identity 暂不可用延后。`request_admission.py` 通过 `llm/admission.py` 的每请求 provider 包装额度关联，不共享请求可变状态。`GenerationTaskStore` 的显式准备回调在写事务外运行，终态结算回调仅在本服务短事务中执行；旧网站未安装这些新适配器，保持恢复契约。

`llm/library_inputs.py` 拥有文件库输入流、精确长度校验和每请求装配；`legacy_library_inputs.py` 仅供恢复网站读取旧素材库。独立 `studio/apps/model_service/library_inputs.py` 经 Identity 的来源／目标权限复核读取 `studio/apps/asset_library/library_inputs.py` 与私有路由提供的账号文件流，不挂载 Assets 目录或查询其表。版本化私有描述归 `studio/runtime/files/incoming.py`，不包含路径或存储键；项目、Galgame、剪辑和特效专属素材均不作为文件库输入。推理输入和转录在文件复制后使用自有表提交；转录的暂存与提交归同一流程，提交未决不得删除可能已登记的输入文件。

`llm/library_outputs.py` 定义每请求结果保存端口；恢复网站显式注入 `legacy_library_outputs.py`，独立 Models 注入 `studio/apps/model_service/library_outputs.py` 的有界 HTTP 输出。`studio/runtime/files/signed_payloads.py` 把文件名、MIME、大小和内容 SHA256 绑定到目标路径；Identity 只从同一任务的保存操作签发窄用途委托，Assets 在接收前和流式传输后复核原身份。`studio/apps/asset_library/library_outputs.py` 在网络／文件 I/O 完成后以短事务保存自有文件和 `0004_model_output_receipts` 不可变回执，并发或响应丢失重试只返回同一文件；已删除结果不自动复制重建。私有结果接口不进入浏览器路由、公共 OpenAPI 或 SDK。未知提交保留可能已登记的字节，不按超时清除。

生成测试只读取 Models 私有参考与结果；`playground/legacy_generation_references.py` 是恢复网站显式装配的旧素材查询／回填适配。独立服务缺少该适配时拒绝未迁移的历史引用，正式转移前须通过旧站的正式回填 API 完成转换。附件和结果缩略图直接使用 `runtime/raster.py`，不会为纯栅格处理加载 Assets ORM；上传、回填与结果提交在取消或提交回执未知时保全可能已提交的文件。

`capabilities/transcription/catalog_values.py` 定义参数／能力函数所需的模型与供应商值协议，不注册 ORM。`llm/playground/__init__.py` 只声明包，各消费者直接引用具体测试模块；读取转录能力不会隐式加载文字测试、演示服务或旧数据库。文字、输出交付、生成素材和原生模型端口仍须继续隔离。

`llm/catalog/default_storage.py` 定义默认选择的显式存储端口，与目录 CAS 使用同一事务；恢复网站在入口装配点和 `catalog/legacy.py` 兼容用例中提供 `legacy_defaults.py`、`legacy_usage.py`，独立实现不得导入这些兼容适配器。旧 `platform_settings` 的 `account_defaults:` 分区归 Models，正式导入仍须业务接口校验与核验。`llm/models/model_templates.py` 与 `runtime_admission.py` 拥有模板同步和额度记录；旧 Console 模型公开名仅作明确兼容导出，恢复用例继续从模型能力直接导入自有记录。

`llm/catalog/http_bindings.py` 提供不可变的每应用目录装配描述与账号绑定的 HTTP 用例依赖；恢复网站在 `main.py` 安装旧存储／任务占用适配器，目录、供应商和本地模型挂接路由不再直接构造旧适配器。`routes/models/diagnostics.py` 单独拥有模型诊断协议，避免目录只读装配加载供应商执行栈。`llm/http_errors.py` 统一模型操作错误映射，不导入其他路由。独立进程的目录 HTTP 切片验收不等于完整 Models 服务就绪。

`llm/admission.py` 定义不可变的额度申请、释放、任务保留与派生任务接纳绑定；模型 HTTP 与实时语音从自己的 ASGI 应用取得它，恢复网站显式安装原治理实现。`llm/inference/receipts.py` 只依赖 Models 任务记录，负责账号限定的请求回执与摘要冲突校验，避免为重放检查导入素材能力。独立账本、队列和跨服务任务授权仍须单独实现，缺少绑定不允许回退单体数据库。

`backend/studio/apps/creative_workshop/` 拥有 Creative 自有表、安装 outbox、文件和独立应用。公开目录复用旧站 HTTP 契约，账号写入继续由 CAS 和持久回执保护。独立应用按签名请求从 Identity 查询作者显示名，只读取 Creative 自有目录中的封面及 Skill 文件。`source_http.py` 根据网关签发的请求体证据，经 Integrations 的 `creative_sources_http.py` 读取同账号快照并核对 Skill 归档摘要。`preview_http.py` 通过按批次摘要绑定的授权查验目标名称与已安装状态。`stdio_http.py` 按安装记录和配置摘要委托 Integrations，环境值由 Integrations 加密保存。Creative 验签后更新安装投影，原安装回执保持可重放。镜像和浏览器入口可独立构建，`deploy/creative.compose.yaml` 提供隔离验收装配。作品认证与历史迁移仍是上线门禁。

`backend/studio/apps/integrations/` 拥有独立工具、MCP、Skills、外部连接 HTTP 装配、自有迁移和执行回执。`studio/contracts/integrations/integration_intents.py` / `integration_client.py` 将来源账号请求、资源与输入摘要绑定到 Identity 固定执行意图；Models 自有验证额度和演示安装回执保留跨服务幂等，不读取 Integrations 数据库。飞书同步由私有固定步骤协议执行，未知供应商响应不能自动重放。Skills 文件按本服务已提交记录恢复。`native_mcp.py` / `native_http.py` 对接主动连接的 Mac MCP worker，容器不持有主机命令、个人环境或目录。`deploy/integrations.compose.yaml` 只挂载所属状态、只读配置与用途限定凭据，外联使用单独网络；是否启用由 TOML 中明确选定的镜像决定。完整容器、原生与浏览器验收仍为正式切换前置条件。

`studio/apps/integrations/storage/catalog_migration.py` 提供 Tool API、MCP 服务与发现工具、外部连接和检查历史的数据集。独立回环维护入口使用目标私有 TOML 的原加密密钥校验凭据，导入事务保留密文并提交批次回执。


`studio/apps/thought_workshop/retention.py` 使用自有 outbox 持久保存素材引用准备、源事务结果与确认状态；`note_retention.py`、`template_retention.py`、`knowledge_retention.py` 将已接入的笔记、模板和知识库创建绑定自身 CAS 与引用回执。知识库创建在提交项目前，分别保护封面和自动首页的初始引用投影；更新知识库时，封面的替换或移除与知识库 CAS 和引用回执一起提交。`studio/contracts/thought_workshop/community_assets.py`、`studio/apps/identity/community_assets.py`、`studio/apps/thought_workshop/community_evidence.py` 和 `studio/apps/asset_library/community_assets.py` 提供单素材社区读取：Identity签发短期用途限定授权，Assets 每次读取都要求 Thought 在独立会话复核当前发布、浏览者权限、正文引用与资源版本，并重新检查浏览者 Session。独立 Thought 的社区文档保存复用发布授权和文档 CAS，通过绑定编辑者、源账号、发布和文档修订的引用授权返回所需文件元数据。事务内重查发布权限并持久记录引用结果。多维表格批处理使用同一引用授权，重新核验嵌入来源、目标发布与逐篇编辑权限，并保留历史表格素材。社区上传的私有暂存按发布文章、编辑者、源账号和文件摘要授权，Assets 封存文件后等待源结果。公开上传在 Thought 同一事务保存文章附件关联和结算结果，后台重放已确定结果。未进入正文的附件仅限该文章的原上传编辑者预览。社区缩略图尺寸包含在签名授权中，Assets 在逐次复核授权后使用同一有界解码和素材版本缓存。独立启动由 `studio/apps/thought_workshop/__main__.py` 装配，显式核验自有迁移、操作 ID 和浏览器契约。新建文档、知识库、笔记批处理、历史恢复、模板创建与应用及多维表批处理、历史恢复和 CSV 导入已接入 retention，其他写操作仍需逐项接通。

`studio/apps/creative_workshop/installation_outbox.py` 和 `installation_coordinator.py` 保存按账号及版本绑定的安装意图。安装前保护根发布及组件，目标结果未知时保留围栏。Creative 与 Integrations 分别保存取消回执及阻止迟到提交的状态，源端只在验证签名回执后释放围栏。`decision_http.py` 与 `creative_authority.py` 通过独立对等凭据绑定原请求、持久批次和发布状态。`studio/contracts/creative_workshop/creative_results.py` 与 `install_target.py` 对目标回执及不存在响应使用独立密钥和逐请求随机数认证。`skill_archive.py` 和 `install_batch.py` 绑定固定格式归档和文件树摘要，保留对历史无树摘要回执的恢复。`install_authorization.py` 在提交和结算时复核原始请求体与当前身份授权。

Creative 的公开作品认证由 `certification_http.py` 转发。Identity 签发绑定账号、项目类型、标识和版本的命令，Visual 与 Galgame 只修改各自项目库。项目更新和待审计回执共用事务，Identity 去重写入并签发审计确认，Creative 验证后返回。两套项目库已登记初始自有 schema。各自的 `projects_http.py` 提供公开项目目录、创建、详情和初始编辑文档读取。新项目与初始 Canvas 或 Story 在同一事务提交，文件目录由素材服务在首次写入时创建。Visual 项目元数据更新使用原有版本契约。认证标记和项目版本从同一条项目记录读回。Visual 的 `outputs/recording.py` 只登记自有输出；独立与兼容站共用 `outputs/queries.py` 读取输出列表和版本，兼容站的素材校验及输出变更仍由 `outputs/history.py` 承担。 `canvas_documents.py` 持有画布事务，`studio/apps/visual_workshop/canvas_writes.py` 用 Assets 的范围校验回执准备素材引用并提交版本。Assets 的 `canvas_retention.py` 核对项目素材、库内放置与前序引用保留。`operation_values.py` 转换操作批次，Visual 保存自身的 `project_operation_receipts` 分区，与画布版本和素材引用回执一起提交。 Galgame 的 `story_writes.py` 以 Story 版本维护素材引用投影，项目创建时准备空投影。故事保存先由 Assets 固定素材归属及元数据，再在 Galgame 库中原子提交正文、素材索引和待确认回执。已保存的 Story 快照也纳入保留范围。对白、舞台表情及批量编辑通过 `story/edit_values.py` 复用兼容站的值校验，并由同一 Story 事务推进版本和回执。操作批次通过 `story/operation_values.py` 转换，已执行批次的请求摘要和原结果保存于 Galgame 自有的 `project_operation_receipts` 分区。`story/snapshots.py` 负责已核验账号的历史列表，快照恢复按当前 Story 版本提交原始文档和引用。

Galgame 广播剧导入由 `studio/apps/galgame_workshop/annotation_runner.py` 执行。Annotation 提供归属已校验的文档版本，Assets 提供绑定 SHA256 的原件和生成片段回执，Identity 在执行时复核原请求权限。裁切与内容相关性校验由 `app/capabilities/media_rendering/voice_clips.py` 维护。Galgame 在自有状态目录的 `.annotation-work/` 暂存文件，在同一事务保存 Story、旧版本快照和任务回执。独立 Galgame 镜像使用 `deploy/images/owned-http/Dockerfile.galgame` 装入固定版本的 FFmpeg。

Galgame 便携 ZIP 的导出与导入归 `studio/apps/galgame_workshop/snapshot_exports.py` 和 `snapshot_imports.py`。两套网站装配共享 `studio/apps/galgame_workshop/snapshot_values.py` 的文件元数据与 Story 校验。Assets 的 `studio/apps/asset_library/galgame_archives.py` 同事务公开原件与初始 Story 素材引用，Galgame 在收到结算回执后公开项目副本。

Galgame 台词转写任务与转写版本归 `studio/apps/galgame_workshop/asr_jobs.py`、`asr_runner.py`。Assets 核验项目与文件版本后提供原音频。Models 的 `studio/apps/model_service/galgame_transcription.py` 执行已冻结的模型调用，并持久记录结果和调用日志。请求中断时，Galgame 用原任务标识读回结果。Models 重启时将未决的供应商请求记录为结果未知。

Galgame 精确帧的业务预检归 `studio/apps/galgame_workshop/exact_frame.py`。Rendering 通过 `studio/apps/media_rendering/galgame_frames.py` 校验 Story 摘要和同一账号的 Assets 原件授权。确定性编译、字幕和口型位于 `app/capabilities/media_rendering/galgame/`，供兼容装配和独立 Rendering 共用。

Galgame 成片任务与冻结 Story 由 `studio/apps/galgame_workshop/export_jobs.py`、`export_runner.py` 持有。Rendering 的 `galgame_export_jobs.py` 执行并封存已核验的 MP4。Assets 接收绑定摘要的成片，并负责 `storage.galgame_export_max_bytes`。Galgame 持久记录同一上传回执后开放下载，最后释放 Rendering 的暂存副本。

Galgame 剪辑交接由 `studio/apps/galgame_workshop/handoff_jobs.py`、`handoff_runner.py` 协调。Rendering 的 `galgame_handoff_package.py` 生成包含可编辑时间线的 Video 工程包。Video 通过 `galgame_handoff_http.py` 接收，按源任务绑定归档摘要，在原件完成结算后公开工程副本。Galgame 按同一回执取得目标工程标识。

`studio/apps/thought_workshop/upload_intents.py` 与 `studio/apps/asset_library/thought_uploads.py` 提供按账号绑定的私有上传回执，Identity 只为指定来源和目标签发上传委托。`upload_transport.py` 为已暂存上传逐请求换取绑定摘要的 Identity 委托并流式传输，来源服务仅在收到按账号、文件摘要和随机数认证的有效回执后确认并清理暂存；Assets 未配置独立回执密钥时拒绝该私有上传。`upload_recovery.py` 在启动独占锁内仅清理已确认副本和无持久意图的中断暂存；未决意图继续保留。该协议已通过隔离服务测试；独立 Thought 已装配公开上传入口，远端自动重放 worker 尚未接入，恢复网站暂不按重试标识去重。独立 Thought 的部分 HTTP 装配已包括目录移动、文档恢复和知识库回收／恢复，并保留现有版本控制及撤回发布规则；retention worker 已存在，但 `/ready` 始终返回 503，直至素材引用迁移及剩余业务能力完成。

`backend/studio/apps/thought_workshop/` 拥有 Thought 自有表清单、仅保留自有外键的独立迁移与写作 HTTP 适配，通过显式选择的 `deploy/thought.compose.yaml` 提供独立部署入口。`web/src/app/entries/thought.tsx` 提供可独立构建的浏览器入口，与兼容站共用 Thought 模块的知识库、社区和旧链接路由。搜索、引用解析、反向链接、复制预检、检查点、阅读偏好、表格查询、社区收藏、社区管理元数据、官方包预检、同步绑定及任务记录查询共用 HTTP 装配。模型写作通过 `studio/contracts/thought_workshop/writing.py` 绑定笔记、请求摘要和原账号操作，由 `studio/apps/model_service/writing.py` 管理模型选择、流式调用、日志及配额。账户备份复用 `backup_manifest.py` 的现有归档格式，`studio/apps/thought_workshop/backup.py` 读取 Thought 一致快照并在结束读事务后按素材版本下载、核对大小及生成归档。素材引用变更通过独立的引用准备与回执提交。共享的 `studio/apps/asset_library/clients/reference_mutations.py` 在来源服务的自有账本中保存准备与结果，重启后补发确认。Thought 保留自己的账本表和正文、历史及表格引用规则。

`studio/apps/thought_workshop/sync_binding.py` 通过按文章、连接和请求摘要绑定的授权查询 Integrations。Thought 保留同步绑定和修订控制，Integrations 持有连接凭据和远程访问。`publication_retention.py` 将公开封面绑定到发布记录，源知识库替换封面时保留已发布素材。发布写入和回执状态共用事务，历史发布在切换前须建立经核验的初始引用。

`studio/apps/thought_workshop/duplicate_retention.py` 为复制的每个文档准备独立投影，保留多维表历史中的素材。复制结果和投影结果共用源事务。`archive_import.py` 拥有备份和官方包共用的清单校验、标识重映射及入库。导入前统一分配知识库、文档与模板标识，并按资源计算正文、表格及历史素材引用。`archive_files.py` 在固定大小和数量上限内校验并解包，使用无 ORM 的 `runtime/zip_members.py` 过滤不安全成员。`studio/apps/thought_workshop/official_projections.py` 为内置官方包创建初始投影，导入回执、来源映射和投影结果一同提交。 独立 Assets 的归档暂存表记录输入摘要、已校验的文件和封存清单。只有确认源提交后才在同一事务发布素材与初始引用；明确中止进入既有文件清理队列。账号归档导入通过原 multipart 入口。Identity 仅允许从该入口向 Assets 委托文件暂存和清单封存，Thought 写入内容时持久化结算结果，后台可在会话过期后提交经对等凭据认证的决议。重传同一归档可恢复未完成批次，显式提供同一 `Idempotency-Key` 可重放已完成结果。仅在对应批次结算确认后清理归档暂存。

`studio/apps/thought_workshop/sync_submit.py` 在排队前固定预览、远端版本和图片摘要，`sync_artifacts.py` 暂存任务私有图片副本。`sync_runner.py` 通过 Identity 的持久任务授权在 Integrations 执行逐步写入，进程退出时把运行中的任务置为待核对。`sync_reconcile.py` 使用只读步骤回执及远端快照核对已确认写入，或显式关闭任务以阻止迟到写入。供应商连接、远端步骤记录和关闭回执留在 Integrations。

`studio/contracts/gateway/routing.py` 分别维护 HTTP 操作与固定 WebSocket 归属。实时语音只接受实际 Upgrade 握手，网关清除外部身份头后标记协议并交 Identity 复核；管理网关不开放该入口。`protocol_hash.py` 只将本服务的 Socket 契约纳入版本，公开 OpenAPI 不伪造普通 GET 操作。

`studio/runtime/database/migrations.py` 在只读预检中核验已应用历史的位置、服务、版本和 checksum，使用转义 URI 保留真实路径字符。显式迁移接受有效历史前缀，启动检查要求完整注册表；打开目标连接后先重复校验，再设置 WAL 或创建表。错误归属与漂移库保持原状，不自动修复或接管未登记旧库。

`runtime/image_sizes.py` 和 `runtime/raster.py` 维护无 ORM 的图片尺寸及受限解码；头像通过 Identity 自有适配使用，不为头像导入素材数据库。`media_rendering/preview_metadata.py` 和 `pdf_preview_worker.py` 拥有实际文本、PDF 与媒体预览；旧素材入口只负责账号查询适配。PDF 使用限时子进程，宫格字体按白名单封入 Rendering 镜像。Assets 上传暂存位于自己的状态卷，避免大文件占满容器内存临时盘。`scripts/website/rendering_docker_checks.py` 使用合成媒体验证真实容器链路，`assets_docker_checks.py` 覆盖超过内存临时盘大小的上传与 ZIP 导入。

`capabilities/asset_store/folders.py` 复用同属文件能力的文件夹 CAS、名称和深度规则；`asset_context.py` 允许显式注入项目验证。新 Assets 数据库将外部项目 ID 视为不透明标识，仅保留自有表外键；旧迁移与数据库外键保持原样，迁移期单体继续使用旧适配。`studio/contracts/asset_library/references.py` 维护受限消费方、资源种类和版本化引用消息，不接受客户端指定归属。

`backend/studio/apps/agent_workbench/` 装配独立工作台，拥有自有迁移、原生任务、来源订阅、投影回执、协调器与私有协议；复用工作台的阅读、搜索、CAS 和投影用例，不加载账号 ORM 或 Mac 解析器。`studio/runtime/http/dependencies.py` 只消费签名身份；`change_stream.py` 使用显式实时授权与数据库会话，旧 `events.py` 保留单体身份适配。

Agents 的 `execution_discovery.py` 拥有账号项目发现、登记和创建对话的 Mac 任务边界，`execution_native_http.py` 装配专用回环凭据与租约。`studio/contracts/agent_workbench/execution.py` 保存范围与结果契约。`studio/host/workbench_worker.py` 在受信 Mac 核对项目根与 CLI 签名。工作台的 `execution/turn_records.py` 保存兼容站和独立服务共用的轮次事务原语。 `execution/project_tools.py` 持有项目文件与命令工具，运行端提供实时授权和审批回调。

`studio/host/deployment_preflight.py` 在主机启动或 `--check` 时，只读检查本次选中服务各自数据库的服务归属、迁移前缀与 checksum；仅管理端模式不要求未启动的业务服务。未知已配置服务及缺少状态目录时拒绝部署，不创建数据库或应用迁移。启动动作与管理 worker 在所有预检成功后才执行。

`backend/studio/host/` 是独立 Mac 原生采集 CLI，仅发起受认证回环请求，读取明确来源的原生会话及引用附件。`collector.py` 管理有界任务，`follow.py` 跟随原生日志或事件，`follow_journal.py` 持久化单帧确认状态，`receipts.py` 保存一次性操作意图与结果；不确定动作不重做，跟随仅按原任务、租约和服务端检查点继续。容器镜像不包含此包。

`studio/apps/gateway/creative_bridge.py` 为 Creative 来源导入与安装提交提供请求体证据。启用隔离验收配置后，Caddy 先向 Identity 授权原始操作，再通过容器内专用 Unix socket 交给中介。中介验证入口凭据与原断言，要求 Identity 为精确原始字节签发短期证据，验签后原样转发。Creative 安装提交通过 `installation_http.py` 复用持久批次、发布围栏和受保护的 Integrations 回执。重复收到同一份已证明的来源导入请求时，Creative 重新使用已落盘的草稿 ID。

Agent Runtime 的 `backend/studio/apps/agent_runtime/` 拥有编程智能体目录、检测、启用和原生回执队列。
`backend/studio/host/agent_execution/agent_connections_worker.py` 通过独立回环入口执行本机 CLI 探测，在写入部署配置前再次核验授权。
`deploy/agent-runtime.compose.yaml` 只挂载服务自有数据与最小凭据。
独立页面由 `web/src/app/entries/agent-runtime.tsx` 构建。

Models 的 `backend/studio/apps/model_service/catalog_migration.py` 按账号传输历史目录和加密供应商凭据。
Assets 的 `backend/studio/assembly/independent/asset_library/maintenance.py` 装配文件夹、素材记录及原件的回环维护入口。`backend/studio/apps/asset_library/library_reads.py` 提供账号文件库查询，音频标注通过专用签名协议读取元数据和对应修订的音频，并为项目准备素材引用。`backend/studio/assembly/independent/audio_annotation/application.py` 装配自有项目、文档、波形和回执，兼容应用通过同一业务入口绑定旧站数据端口。
面试助手的 `backend/studio/apps/interview_assistant/` 独立装配签名接口、场次数据库及私有材料目录。兼容站仍由现有 Codex runner 执行。独立面试助手通过 `backend/studio/host/agent_execution/interview_worker.py` 领取固定准备任务，并通过 Identity 复核账号权限。
导演台的 `backend/studio/assembly/independent/director_desk/maintenance.py` 装配回环维护入口，按账号迁移原项目、动作及其文件。
独立 Amadeus 由 `backend/studio/apps/amadeus/` 装配，拥有六张对话、运行、消息、问题、动作和事件记录表。共享记录与恢复规则位于 `app/console/amadeus/run_records.py` 和 `run_recovery.py`，兼容站在 `runs.py` 绑定原 CLI 连接。 `skill_pins.py` 固定对话加载的 Skill 版本并校验来源原件，`studio/apps/integrations/amadeus_skill_archive.py` 装配受控的同账号快照，`app/console/amadeus/skill_files.py` 按原路径读取固定版本文件。`native_host.py` 保存精确原生任务与回执，`studio/host/amadeus_worker.py` 通过专用回环入口核验本机 Finder 租约并探测脚本沙箱。`dialogue_runs.py` 持久化对话进度和工具审批，`studio/host/amadeus_dialogue.py` 拥有实际 CLI 连接与进程，`deploy/images/amadeus/` 锁定独立的工具 Schema 验证依赖。门户复用页面侧栏并按侧栏容器宽度布局。

Remote 的 `backend/studio/apps/remote_desktop/` 拥有桌面偏好、短期连接票据与 WebSocket。 `studio/host/cloud_projection.py` 按归属发布 Mac 云控策略，`studio/config/cloud_projection.py` 核对当前提交和服务自己的 TOML 摘要。Remote 维护受认证的设置租约与结果，`studio/host/cloud_setup_worker.py` 在 Mac 按配置修订保存并发布投影。
共享 `app/console/cloud_control/desktop_bridge.py` 负责 Guacamole 协议，旧站与 Remote 分别注入自己的授权和连接端口。历史偏好由 `studio/apps/remote_desktop/preference_migration.py` 在回环维护入口导入，Identity 的 `credential_migration.py` 保留加密 TOTP 登记与归属会话。
`deploy/remote.compose.yaml` 只装配私网桌面服务，另需显式选择 Guacamole 对端。Identity 提供限定到原请求的会话复核。

Agents 的 `execution_http.py` 读取自有聊天记录并逐次复核 SSE 授权。共享的 `studio/apps/agent_workbench/execution/transcripts.py` 管理会话读回及中断状态。独立立即轮次由 `execution_turns.py` 持有事务与租约，`studio/host/workbench_turn.py` 在 Mac 执行并提交回执，兼容站与独立服务共用 `turn_activity.py` 的活动投影。

`studio/deployment/images.py` 构建可审计源码闭包，`gateway.py` 从操作归属生成监听器路由。`deploy/images/` 下 Identity、Agents、Gateway、Portal、Assets、Rendering、Management、Models、Integrations、Thought 和 Creative 各自保存依赖锁和镜像定义。Remote 单独使用 `deploy/images/remote/` 锁定 WebSocket 和图片转换依赖。Visual、Galgame、Tools、Director 与 Agent Runtime 共用 `deploy/images/owned-http/` 的依赖锁和镜像定义，镜像构建各自检查源码闭包。`deploy/compose.yaml` 装配基础服务。Mac 管理启动器通过 `studio/host/deployment/compose_selection.py` 按显式镜像和功能配置合并所有服务叠加清单。项目所有者和功能挂载按依赖顺序装配，Guacamole 随 Remote 进入业务启停组。Models 只挂自有状态、最小配置和身份连接，使用单独外联网络请求供应商。`scripts/website/service_build.py` 和 `service_docker_smoke.py` 分别提供 CLI 构建与账号容器隔离验收，`agents_docker_smoke.py` 验证真实工作台容器和 Mac 原生采集器；`tests/gateway_assertion_probe.py` 只属于测试传输探针，不是工作台服务。运行及切换状态见[独立服务迁移](../operations/independent-services.md)。 `backend/studio/apps/tools/` 独立装配账号收藏和最近使用 API，使用自有数据与身份公钥。`deploy/tools.compose.yaml` 提供隔离启动，`web/src/app/entries/tools.tsx` 构建工具目录和两条深链接，`studio/apps/tools/host.py` 管理本机文件库目录任务与回执。`studio/host/tools_worker.py` 从专用回环入口领取有效租约，只在配置的 Assets 根目录下解析当前账号的文件库。视频下载依赖探测复用回环 worker，公开入口隐去可执行文件路径。`videos.py` 保存下载任务，`video_files.py` 核对字节摘要并保存交付回执，`video_library.py` 通过限定授权把文件流交给 Assets。Mac 下载中间文件由 `studio/host/tools_video.py` 管理。 `studio/contracts/management/migration_batches.py` 定义迁移运行计划、规范化摘要和账号回执；Tools 的 `navigation_migration.py` 拥有历史导航数据集，`migration_application.py` 装配独立回环维护入口。由 `scripts/website/migrate_tools_navigation.py` 传输并双向核验批次。

Galgame 的历史导出与导入由 `studio/apps/galgame_workshop/migration_application.py` 装配。旧 Story 当前索引与快照引用由源侧核对，Assets 校验已导入的文件回执后建立引用投影。批次编排与读回位于 `scripts/website/migrate_galgame_history.py`。

Visual 的便携 ZIP 导出由 `studio/apps/visual_workshop/snapshot_exports.py` 冻结 Canvas、输出与验收记录。Assets 的 `visual_snapshot_files.py` 核对同账号项目范围、库内引用和原件版本，按已授权的精确文件集合流式提供原件。Models 只返回模型提供方类型与标识。下载前重新核验会话，ZIP 和工作副本在响应结束或进程恢复时清理。 `studio/apps/visual_workshop/snapshot_imports.py` 保存 Visual 的精确导入决议，`snapshot_graph.py` 验证副本的画布、历史输出和验收关联。Assets 的 `visual_archives.py` 原子公开已核验的文件、嵌套目录和两类素材保留集合。Visual 收到回执后才公开同一副本。

Visual 的图片宫格由 `studio/apps/visual_workshop/compositions.py` 保存批次与输入版本，`composition_runner.py` 恢复执行与结果结算。Assets 的 `visual_grid_files.py` 核验同账号工程图片。Rendering 的 `visual_grids.py` 使用精确原件、字幕和现有字体渲染 PNG。Visual 将新输出与 Canvas 回执一起保存，Assets 确认后完成批次。活跃的旧站合成必须在迁移前结算。

Visual 生成模型资格、参数校验和供应商请求组装由 `app/llm/visual_generation_model.py`、`visual_generation_payload.py` 与 `visual_generation_submission.py` 共享。兼容站从同进程传入显式素材读取端口。独立 Models 的 `visual_generation_http.py` 按账号返回资格校验后的模型标识，Assets 的 `visual_generation_files.py` 核验指定工程与任务的精确原件范围、版本与读取权限。Models 的 `visual_generation_intake.py` 保存精确的输入、额度和执行决议，`visual_generation_runner.py` 在激活后复用通用生成状态机，`visual_generation_results.py` 提供受控状态、重试和原件读取。Visual 的 `generation_intake.py` 冻结画布输入，`generation_decisions.py` 在源事务落盘后投递激活。 `generation_runner.py` 投影任务进度、发布同摘要结果并确认清理，`generation_batches.py` 汇总子任务并调度可选合成。

Visual 验收取样由 `studio/apps/visual_workshop/acceptance_samples.py` 核对记录及版本。Rendering 的 `visual_samples.py` 根据已校验的原视频版本和实际解码时间戳提取 PNG。Assets 的 `visual_evidence_upload.py` 校验整组帧的长度与摘要，在验收记录提交后公开原件。逐验收记录的证据保留集合随所属项目删除，兼容站的历史保留集合仍按工程核验。

Visual 的公开验收目录由 `studio/apps/visual_workshop/acceptance_options.py` 装配。固定视觉模型由 Models 核对账号与配置，Mac 上的五种 CLI 由 Agent Runtime 通过独立只读租约探测。Identity 限定授权来源，目录响应只包含可用状态和展示字段。 节点验收资料由 `acceptance/context_values.py` 从所属画布和生成记录计算，并从 Assets 读取精确的工程素材投影。方案绑定在 Visual 中按版本更新，项目汇总复用相同的资料指纹。

Visual 节点验收的 `review_submission.py` 按画布、方案绑定和资料指纹冻结运行计划，在同一源事务记录初始素材引用。`review_runner.py` 复核执行账号，`review_baseline.py` 保存逐来源取样及 Assets 回执，`review_media.py` 负责受控证据流，Rendering 负责规范化 JPEG 编码。Models 的 `visual_review_attempts.py` 保存固定模型运行摘要、调用日志和可重放结果。

Visual 的 `review_agent.py` 冻结已保留的 Mac 任务媒体和固定连接签名，`review_authority_http.py` 复核该精确运行是否仍可执行。Agent Runtime 的 `review_host.py` 保存不可重派的原生租约并代理 Assets 原件流。`studio/host/visual_review_worker.py` 在 Mac 的隔离任务目录执行现有 CLI 适配器与专用媒体工具，回传报告和经摘要校验的追加帧。Agent Runtime 的暂存清理只处理已到期租约的已知文件。

Models 的 `assistant_model_runs.py` 负责 Visual 助手的提供方执行租约、标准化模型轮次流、用量和调用日志；`studio/contracts/visual_workshop/visual_assistant_model.py` 拥有跨服务轮次契约。Visual 持有对话和工具执行权限。

Assets 的 `conversation_files.py` 按对话保留集投影助手附件内容。共享 `app/capabilities/asset_store/assistant_media.py` 负责文本、PDF 和 AVIF 的原件读取与兼容限制。Visual 的源回执确定新引用，历史附件仍保留原归属。

Visual 的 `assistant_submission.py` 冻结对话和画布版本，准备附件与模型额度后提交消息与源回执。`assistant_dispatches.py` 在 Visual 持有消息结算，使用短时服务签名向 Models 补交原调用的日志结果。源运行只保存归属、范围和结算数据。

Visual 的 Canvas、工程与历史输出由 `studio/apps/visual_workshop/migration_application.py` 导出及导入。 Visual 与 Galgame 复用 `studio/runtime/database/edit_receipt_migration.py`，在 Canvas 或 Story 导入后分账号保留历史操作回执和原响应。迁移阻止跨归属、缺少源文档或回执版本超出当前文档的记录。Canvas 文件保留集合包含当前节点及旧输出，Assets 逐文件校验回执后提交。库内放置通过 Assets 维护入口保留原名称、目录、标识和版本。 Visual 的 `migration_generation.py` 逐账号保留历史生成任务和批次，核对画布或输出的任务来源与批次成员归属。 `migration_acceptance.py` 保留验收定义、历史结果、修复草稿和证据关联，Assets 在核对原件与工程范围后重建验收素材保留集合。

Visual 助手的对话、消息和操作记录由 `studio/apps/visual_workshop/conversations.py` 查询。模型选项由 Models 提供账号投影，附件元数据由 Assets 按项目、对话、精确 ID 和保留引用核验。新建及删除对话与素材引用回执共用 Visual 数据事务。 `studio/apps/visual_workshop/migration_assistant.py` 逐条迁移历史对话、消息、附件和操作。Assets 在画布投影与原件摘要通过后恢复同工程的对话素材引用。 Visual 删除项目时由 `studio/apps/visual_workshop/project_deletion.py` 核对项目版本、画布和对话范围，提交删除与恢复回执。Assets 的 `visual_project_removal.py` 在确认回执后清除画布与对话引用、项目放置和私有原件，保留文件库原件。项目文件、放置和分段交接发布在 Assets 写事务中检查删除准备。 Visual 的素材节点与输出上传由 `studio/apps/visual_workshop/uploads.py` 准备画布引用，Assets 的 `visual_upload_stages.py` 流式验证长度与 SHA256，并在画布事务确认后发布原件和引用。GIF 检查版本与 MP4 同批发布；暂存失败和源回滚由 Assets 的日志与清理生命周期处理。

`web/src/app/entries/` 拥有独立应用装配与导航，`agents.tsx` 不加载门户路由，`IndependentShell.tsx` 复用账号、主题和导航组件。`web/service.config.ts` 选择单一入口和所属程序素材，`web/scripts/build-service.mjs` 生成逐文件 SHA256、gzip／Brotli 及单服务契约清单；产物保存在被忽略的 `.local/service-web/`，镜像封装时核验清单。`scripts/website/web_contract.py` 仅读静态契约，不初始化数据库。Models 的 `models.tsx` 只装配模型目录、测试和日志，保留当前账号权限、未保存导航保护及跨应用跳转。程序版本摘要包含所属 HTTP／WebSocket 契约，防止契约变化复用旧缓存；其他服务的契约变化不改变本服务协议摘要。 Visual 的 `visual.tsx` 与 `VisualApplication.tsx` 装配项目、画布、素材和任务入口，复用 Visual 功能页面及权限分支。Visual 镜像在提供程序资源前比对已安装程序的 API 摘要。 Galgame 的 `galgame.tsx` 与 `GalgameApplication.tsx` 独立装配项目列表、总览、编辑及预演，保留账号权限和已保存 Story 的预演回退。

`shared/ui/NavigationProtection.tsx` 在每个独立应用内协调多个未保存保护，协议与 Hook 位于 `navigationGuards.ts` 和 `useUnsavedNavigation.tsx`。确认逐项进行，全部通过才继续；明确同意跨页面离开后不重复触发原生提示。`platform/api/applicationBuild.ts` 携带非鉴权的应用版本标记并广播本应用更新，`platform/programAsset.ts` 定位当前程序资源。共享登录通过显式回调清理应用自有临时状态。

服务化实现及 Compose 切换尚在隔离工作树验证，正式入口仍使用下述网站单体；不得把清单生成视为应用迁移完成。当前网站 `.runtime/` 是唯一迁移真源，桌面原目录仅用于恢复。

共享前端构建的 HTML 与版本信息跟随当前构建。经过清单验证的哈希资源可从最近两版退役构建读取，每版自退役起最多 24 小时。`runtime/website_releases.py` 提供服务器与构建器共用的保留策略，正在传输的资源持有目录共享锁。

`runtime/website.py` 拥有可信本机 socket、SPA 静态托管和来源校验；`runtime/remote_web.py` 拥有公网 Host／Origin、浏览器 Session／受控 API Key 和缓存边界。`capabilities/web_access/` 拥有公网回环监听器、专用 SSH 重连和状态；附加 lifespan 关闭，不重复初始化数据库或 Runner。

`scripts/website/serve.py` 在导入数据库前检查配置和迁移、持有目标与原桌面数据锁；`application.py` 在每个重载 worker 导入数据库前复查迁移，并装配网站与公网生命周期；`service.py` 管理同一个用户级 LaunchAgent，`development.py` 持有单例启动锁、沿用现有 TOML 和数据、按后端就绪顺序启动构建监听并统一清理进程，`frontend.py` 校验并原子切换本机与公网共用的构建，`Caddyfile.shared` 定义公网转发网关，`install_client.py` 核验原客户端授权并安装用户级 fpl 命令，`configure.py` 在停机快照约束下发布网站配置，`data_transfer.py` 拥有停机快照、SHA256、只读 SQLite 核验和文件发布回滚，`cleanup.py` 只清理受控缓存与有正式关联副本的临时媒体。相邻独立工具入口供 Amadeus／面试准备子进程调用，不启动主应用。

`console/governance/automation.py` 校验资源归属并返回网站路径；`automation_operations.json` 维护 SDK／MCP 白名单，`automation_access.py` 将其编译为本机／公网共用的入口策略；`console/routes/automation.py` 负责发现和本机管理员访问控制。`sdk/python/src/future_props_lab/website.py` 保存受保护客户端连接，`cli.py` 提供 fpl。

`features/amadeus/PageProvider.tsx` 持有当前账号的页面侧栏，`PageContext.tsx` 和 `pageBridge.ts` 明确传递页面、选中引用和审批后变更；`platform/assistant.ts` 仅提供无状态的打开请求。`features/accounts/WebsiteAccessDialog.tsx` 只在后端确认的本机入口向管理员展示。`web/scripts/prepare-studio-release.mjs` 生成构建清单及预压缩资源；云端发布工具归 remote-control。

## 思绪工坊官方知识库

`web/src/features/thought-workshop/official/` 保留现有指南的导入来源：稳定清单、Markdown、简介、相关阅读和 CanvasScene。它不参与运行期社区列表、搜索或阅读。`scripts/official_seed_source.ts` 提取受控来源，`scripts/build_official_seed.py` 转换为普通 version 7 备份包，生成 `backend/studio/apps/thought_workshop/publication/seed.json`；`knowledge:seed:check` 验证来源与包一致，网站后端提供该 JSON。

`publication/imports.py` 复用普通备份导入用例，平台管理员在当前账号明确确认数量后创建 12 个私人库、93 篇文章及 12 篇首页。导入正文、目录和跨库 ID 引用与来源映射、请求回执在同一事务提交；回执按账号、操作者、请求 ID 隔离。再次主动导入创建独立副本，不自动发布或覆盖。`OfficialSource` 只定位旧来源，`OfficialImportReceipt` 只记录成功结果。

官方内容与普通发布共用 Notes、编辑器、历史、搜索、收藏、导出和素材权限。Publication 保存 `is_official`、`read_only`、`editable_platform_roles`；只有平台管理员能改官方标记和角色授权。新发布默认只读；源普通成员不继承社区编辑权，逐篇账号授权仍生效，角色编辑授权不扩大可见范围或管理能力。能力字段独立返回，所有写入重新校验当前角色与发布权限。

`community/LegacyOfficialPage.tsx` 保留 `official-knowledge-bases` URL 兼容入口，依据来源映射解析当前可访问的官方发布。唯一匹配跳转，多匹配由用户选择，无匹配显示提示，不回退静态阅读。旧官方引用与收藏使用同一授权边界。`publication/references.py` 解析同一源空间的已发布跨库笔记引用，过滤不可见目标。

`document-layout/` 拥有普通与社区笔记的排版、卡片、动态目录、代码高亮、提示块和导出；`reading.css` 保存共用阅读首页及排版样式；`useDocumentChrome` 的页面状态通过显式 props 提供顶栏 Portal 宿主和整栏展开偏好。文章大纲从 H1–H6 派生父子关系，在右侧停靠或紧凑弹层中展开；折叠状态按编辑事务映射，不进入正文和数据库。`official/homeDocument.ts` 仅构建导入包首页。卡片保存引用和样式，标题、简介按实时权限解析；`KnowledgeTree` 仅表达父子关系。`official/technicalCatalog.ts` 和 `content/technical/figures/` 保存 31 篇技术文档及版本化图形的来源。写作约定见 `docs/operations/official-knowledge-writing.md`。

`tests/test_unified_official_publications.py` 验证导入、重试、权限、官方筛选与旧链接；`web/tests/official-knowledge.test.tsx` 验证来源，`official-reading.test.tsx` 验证兼容入口，`web/e2e/official-knowledge.spec.ts` 在隔离数据中验证实际导入与发布。

`diagrams/` 拥有 CanvasScene 模型、模板、纯操作、React Flow 全屏编辑器、Tiptap 节点、
Mermaid 共用阅读器及 SVG/PNG 导出。运行期选择和视口不进入正文；场景变更进入现有保存队列与历史。
`backend/studio/apps/thought_workshop/schemas/canvas.py` 校验画板结构与关系；
`canvas_export.py` 按同一布局规则输出转义后的静态 SVG，图片由现有导出流程嵌入。
素材追踪、搜索、Markdown 和备份复用思绪工坊现有正式 API，不增加迁移或 HTTP 路由。
`web/tests/thought-canvas.test.tsx`、`technical-content.test.ts`、`web/e2e/technical-knowledge.spec.ts`
及 `tests/test_thought_canvas.py` 检查编辑、内容、只读、可移植性与租户边界。

```text
Future-Props-Lab/
├── .agents/skills/    # 仓库级 Codex Agent Skills；watch 为基于固定上游版本的通用视频分析 Skill
├── .agents/notes/     # 工程决策 Note；按 lifecycle/class 分类，不承载产品文档中心正文
├── .agents/agent-note-templates/ # proposed/implemented/rejected Note 模板
├── .github/workflows/ # 冻结依赖的 Python/Web 质量检查与 Chromium E2E
├── .gitattributes     # 文档图片、固定字体与 VAD 资产的 Git LFS 边界
├── backend/studio/config/ # 独立 TOML 格式、字段映射与一次性 .env 转换；不导入 app 或数据库
├── backend/config.example.toml # 无真实密钥的配置示例；私有 config.toml 不提交、不打包
├── backend/app/
│   ├── main.py        # FastAPI 装配、生命周期与健康探针
│   ├── deps.py        # HTTP/WebSocket 会话、Studio 鉴权与 OwnerDep
│   ├── problem_details.py # 统一协议错误映射
│   ├── api.py         # `/v1` router 装配入口
│   ├── orm.py         # mapper 聚合与账号租户登记
│   ├── runtime/       # 配置、数据库、CAS/轮询、操作批回执、ID/时间工厂与 ORM Base（无业务语义）
│   ├── capabilities/  # 有契约的共享能力：identity、asset_store（VisualAsset ORM + files/媒体 schemas/routes）、agents、media_rendering、transcription
│   ├── console/       # Studio 治理、库级文件用例；自有 models/routes/schemas
│   │   ├── amadeus/   # 助手会话、引用快照、审批执行、沙箱脚本与模型桥接
│   │   └── creative_workshop/ # 跨账号公开创作版本、草稿、安装事务与文件校验
│   ├── apps/          # 已垂直切片的产品 App
│   ├── llm/           # 模型目录、供应商适配、共享生成/实时运行时、测试工作台、调用日志及自有 models/schemas/routes
│   ├── tool_navigation/ # 工具目录状态与抖音/B站视频下载；自有 models/schemas/routes
│   ├── integrations/ # 账号工具 API、MCP、Skill、外部连接；自有 models/schemas/routes
│   └── demo_runtime/  # 固定演示 Mock 运行时；自有 schemas/routes
├── db/migrations/
│   ├── versions/      # 只追加、不可改写的 SQLite migration
│   ├── registry.py    # 有序 migration 注册表与最新版本
│   └── runner.py      # checksum、连续前缀检查和事务应用
├── scripts/website/   # 网站启动、LaunchAgent、数据迁移、临时清理与独立任务工具入口
├── web/src/
│   ├── app/           # Studio 入口、Session Context、路由、配置驱动工坊壳与应用注册表
│   ├── docs/          # Markdown 使用正文、分类与上下文目录、搜索、阅读器及旧链接映射
│   ├── features/      # 账号治理、首页、应用、文件管理、工坊、工具导航、集成中心与模型功能
│   │   ├── amadeus/   # 页面侧栏 UI、后端运行重连、控件选取与原生动态头像源画
│   │   └── creative-workshop/ # 广场、创作、版本详情、能力选择与安装引导
│   ├── generated/     # OpenAPI 生成物
│   ├── platform/      # Cookie/CSRF、API 客户端、认证事件与浏览器语音基础设施
│   └── shared/        # 无业务归属的媒体处理、品牌与主题 UI；live2d/ 提供共用姿态计算与网格渲染
├── web/scripts/       # Web 构建与维护脚本；正式视频导出不在这里执行
├── web/public/docs/   # 文档中心使用的当前真实界面截图
├── web/tests/         # Web 组件测试
├── web/e2e/           # Playwright 浏览器旅程
│   └── fixtures/      # 人物旅程的确定性 API mock 与测试数据；真实烟测不使用
├── tests/             # 后端单元、API、存储与架构测试；大型 Story 契约/API 用例按行为拆分
├── vendor/pi/         # 固定 Pi Agent/AI/Chord/Telemetry 源码快照、来源与许可证
├── scripts/           # OpenAPI/LFS 检查、Agent Note 校验、配置转换、API 导入客户端、离线账号命令与 E2E 账号引导
│   └── demo/galgame_runaway/ # 内容专用演示维护工具；目标项目与素材路径必须显式传入
├── docs/assets/       # LFS 管理的文档/演示图片、来源许可证状态与内容集校验清单
├── docs/operations/   # 故障排查、备份与恢复说明
├── CONTRIBUTING.md    # 开发流程、边界、测试矩阵与交付检查表
├── CHANGELOG.md       # 交付批次的用户可见变化与工程治理记录
├── .runtime/          # 本机 SQLite 与运行期素材（已忽略，不提交）
└── .local/            # 统一本地工作区（已忽略，不提交）
    ├── scratch/       # 未定稿分镜、场景图与实验草稿
    ├── output/        # 本地导出与验收截图/视频/日志
    ├── tmp/           # 中间处理产物
    ├── downloads/     # 外源下载素材
    └── research/      # 与产品无关的调研草稿
```

## 目录与依赖边界

- `studio/config/` 只拥有配置格式与文件转换。`runtime/config.py` 将 TOML 和进程环境映射到 Settings；
  `db/migrations/runner.py` 使用同一格式解析数据库路径，不依赖运行时 `app`。
  `scripts/migrate_config.py` 仅转换配置，不访问数据库；网站启动器在数据库初始化前读取 TOML，历史 .env 转换须由运维显式执行。

- `console/amadeus/` 拥有 `/v1/amadeus` 的会话、消息引用快照、Agent/Plan 运行、持久提问、参数摘要审批与执行记录；
  视频时间线执行由 `apps/video_editor/assistant_operations.py` 提供公共入口，在 `app/api.py` 装配，
  避免 Console 反向依赖工坊实现。`fpl_operations.py` 只允许调用自动化白名单明确登记的业务 HTTP 操作，
  由原路由重新校验账号、权限和资源版本。
  `console/routes/amadeus.py` 只暴露协议。会话文件存于
  `accounts/<user-id>/amadeus/<conversation-id>/{imports,scripts,outputs,tmp}/`，按账号
  读取隔离，文件访问拒绝符号链接和目录穿越。新运行通过 `execution.py` 持有官方 CLI，`tool_bridge.py` 以短期任务工具授权连接正式 API；旧模型轮次与浏览器事件写接口返回 410。
  `web/src/features/amadeus/` 拥有独立 `amadeus.html` 界面、Code Agent 选择、运行状态重连、对话时间线与控件选取；
  `useAmadeusData.ts` 管理账号和会话范围内的读取与订阅，`revisionConflict.ts` 解释会话 CAS 冲突；
  `vendor/pi/` 仅保留历史来源快照，不参与 Amadeus 构建。进程监督由桌面独立工具入口提供，
  不复用携带后端凭据的服务进程。

- `llm/credential_snapshot.py` 保存纯调用归因快照，不导入账号 ORM 或数据库。`llm/http_credentials.py` 让模型 HTTP 入口读取与当前 Principal 匹配的已验证 Identity 上下文中的 API Key ID、显示名与前缀，不跨库读取账号或密钥；实时语音仅接受已经认证的浏览器 Principal。恢复网站在装配时显式安装 `llm/call_logs/credentials.py` 中的账号查询，使用当前应用的会话，LLM 模块不直接导入单体全局数据库工厂。归因只用于日志，不能代替授权。
- `runtime/task_records.py` 拥有内部 Runner 的账号查找与绑定：在无绑定时只读解析本服务任务归属，随后按该账号读取；已有绑定不可覆盖。生成／转录恢复先枚举受影响账号，再分别提交状态与日志，系统读取不授予系统写入。`llm/inference/storage.py` 管理本服务推理输入与输出，启动核对只读取 Models 自有记录与目录，不扫描 Identity 表、不跟随链接、不递归清理或修改其他应用文件。
- `app/deps.py` 从当前 ASGI 应用取得显式会话工厂，业务身份仅消费已验证签名上下文。`console/governance/database_auth.py` 拥有浏览器 Cookie、CSRF、API Key、Session 用途和原实时语音认证的账号数据校验；Identity 与恢复网站在装配时明确安装该适配器，其他应用不加载账号 ORM 或旧数据库。`capabilities/identity/http_context.py` 提供无存储依赖的协议错误、客户端地址和最近重新认证前置条件。缺少绑定不能触发单体数据库回退。
- `llm/catalog/` 拥有供应商分组、接入连接与模型目录。`supplier_records.py` 提供账号限定的
  分组读取及安全输出，`suppliers.py` 通过目录统一 CAS 执行分组写入；协议边界位于
  `llm/routes/models/suppliers.py`。供应商不持有密钥或启停状态，连接通过 `supplier_id` 显式归组。
- `web/src/features/models/catalog/` 拥有受控 `ModelCatalogEditor`、目录分类、供应商树和三层表单；
  `ModelServicePage` 适配账号 API、缓存和冲突恢复，`AccountDefaults` 负责默认用途选择与保存。
  模型服务页面通过可选内容插槽提供「本地模型」标签；`LocalModelsPanel` 与 `LocalModelDetails`
  拥有模型选择、状态步骤和空间接入操作，`useLocalModels` 统一轮询、写入及缓存刷新，
  `localModelPresentation` 根据本机状态和当前空间目录派生摘要与接入状态；共用编辑器仍不发起 API 请求。
  管理中台通过数据、动作和字段权限复用编辑器，
  角色模板草稿、保存及同步由 `features/accounts/` 拥有；共用编辑器不直接请求 API 或持有 revision。
  页面、连接布局和弹窗样式分别由 `model-catalog.css`、`catalog-connections.css`、
  `catalog-dialogs.css` 维护。只读模型服务复用同一目录，隐藏写操作。
- 后端采用功能模块优先结构。`main.py` 负责装配；各包 `routes/` 只负责认证、请求校验、调用功能
  边界和响应映射，不直接导入 SQLAlchemy、ORM 模型或 migration。查询、写入和事务由
  `llm/catalog/`、`llm/playground/`、`llm/call_logs/` 等所属能力负责。
- `console/governance/provisioning.py` 是 HTTP 管理接口和离线账号命令共用的账号开通用例；账号、审计事件与账号模型目录在同一事务内提交或回滚。`console/governance/service.py`
  不依赖模型目录实现。
- `capabilities/identity/permissions.py` 拥有固定角色与密钥范围交集，`capabilities/identity/route_permissions.py` 显式登记业务操作。
  `governance_transactions.py` 在短写事务中重验操作者并执行 CAS；`management.py` 拥有平台身份与账号状态授权，`errors.py` 和 `error_views.py` 定义领域错误与安全快照。
  `console/routes/account_management.py` 只适配管理查询、创建和审计协议。
- `web/src/features/accounts/` 拥有管理中台、个人资料、安全与密钥。`AccountMenu` 提供账号入口，
  `AccountPanel` 与 `useAccountPanel` 装配设置弹窗，`RuntimeQuotasPage` 管理账号和实例额度，`TemplateSyncTarget` 选择共享模型的目标账号。
  `platform/auth/AccountAccess.tsx` 提供账号 ID 与有效权限；`AccountStorageUpgrade` 显示维护升级状态。
- `capabilities/agents/harness/` 提供业务无关的 Agent Definition、消息/工具调用/Usage/适配器契约、上下文预算、
  Reactive 工具循环、Policy、Verifier、事件订阅、取消和内存审批；`phases.py` 原子化上下文编译、
  模型回合、工具提案、执行与审批阶段并保持事件顺序；不拥有项目数据，也不提供通用
  `/v1/agents` 管理接口。`llm/providers/chat_completions.py` 拥有 OpenAI 兼容文本协议的供应商集合、默认地址与 DeepSeek 非思考请求选项；诊断、流式对话、Agent 与日志复现复用该契约。
  `llm/providers/` 是供应商协议差异的唯一实现边界，并反向实现 Harness
  定义的适配器契约。模型测试、诊断、REST/SSE 与 Web 消费端
  只依赖统一结果或事件，不根据供应商原始载荷控制运行行为；供应商管理界面展示配置属于例外。
- `llm/playground/` 拥有模型测试会话、图片上下文、调用快照与单轮流式结算；
  `recovery.py` 在启动时取消遗留的 pending 回复并更新所属会话 revision，避免会话一直占用。
  模型生成／转录／推理 Runner、恢复、文字流和实时语音结算都显式接收所属应用的会话工厂；HTTP 与 WebSocket 从自己的 ASGI 绑定传入，不能回退到单体全局工厂。结算使用独立短事务并显式绑定账号，不能跨网络请求复用同一个 AsyncSession。
  Web 的文字对话和参数控件归属 `features/models/conversation/`。
- `llm/providers/realtime/` 只拥有供应商无关实时桥接契约与 SenseAudio 协议适配，
  `llm/realtime/` 负责账号模型解析、短会话日志结算和浏览器 WebSocket 编排；
  `web/src/platform/voice/` 负责 16 kHz 采集、Silero VAD、回声参考打断和 24 kHz 缓冲播放。
  这些模块不拥有 Bot、工具调用、知识库、电话或持久化实时会话。
- 后端不增加通用 `services/`、`domain/`、`platform/` 或 `product/` 分层。需要拆分大型模块
  时，按具体业务能力在所属功能包内命名，避免同一职责出现多个事实源。
- 工具目录由 Web 静态注册表维护；后端 `tool_navigation/` 持久化稳定工具 ID 对应的收藏与
  最近使用状态，不复制工具名称、分类或外部网址。空间占用与 Codex 模型源页面和主机操作 API 已移除。
  视频下载用例调用本机 `yt-dlp`/`ffmpeg`，仅允许抖音与哔哩哔哩链接，任务与临时文件保存在运行时目录，可选写入文件库。
- `web/src/features/cloud-control/` 拥有云控双栏、远程画面与验证界面。`backend/app/console/cloud_control/` 拥有按账号的 TOTP、桌面 Session 与空闲锁定、可信本机配置保存和 guacd 隧道。工作台仍可从 `/agents` 阅读已同步的原端会话。
  API、SSE 与后台采集同时检查 `cloud-control.access`，身份降级后保留原账号副本和检查点。
  当前网站保留兼容装配，独立服务实现保留在服务化分支并由其统一验收切换。
`web/src/features/applications/ApplicationCard.tsx` 拥有应用目录的紧凑入口卡片；布局、品牌图、简介和能力标签沿用应用目录样式，入口元数据由各装配入口显式传入。

- `integrations/` 拥有独立于工具导航的账号集成目录：`tool_apis/` 管理受限 HTTP 调用配置，
  `mcp/` 管理 Streamable HTTP/stdio 连接与工具快照，`skills/` 管理安全 ZIP 导入和不可变版本，
  `checks/` 只保存脱敏验证元数据。v1 只负责管理、发现和按需验证，不接入 Agent Harness 执行。
- `integrations/external/` 管理账号外部连接、加密应用凭据与飞书鉴权；`contracts.py` 和
  `blocks.py` 接收明确的文档内容与图片素材，`feishu_verification.py` 核验远端块结果，
  不读取思绪工坊 ORM。`/docx/` 链接直接作为文档标识；知识库 `/wiki/` 链接只提取节点标识，经飞书开放接口解析为 docx 后再读写。服务器不请求用户粘贴的主机。
  `apps/thought_workshop/external_sync/` 拥有文章绑定、内容导出快照、持久任务和步骤核验；
  `console/governance/external_sync_access.py` 为执行器提供当前操作者权限检查。
  `features/integrations/external/` 提供集成中心配置，`features/thought-workshop/external-sync/`
  提供文章同步侧栏和移动弹层；共享 `shared/ui/FeishuMark.tsx` 从 `web/public/providers/` 读取本地品牌标识。
  迁移 `r0088_external_article_sync` 追加五张表；全局唯一目标绑定和
  活跃任务索引确保单目标串行。恢复仅将运行任务标记待核对，不自动重放外部写入。
- `console/creative_workshop/` 拥有同一部署内共享的创作目录。草稿按作者和当前账号隔离；
  公开版本和方案包引用跨账号只读，不能经集成中心直接读取其他账号的配置。
  安装记录属于目标账号，安装事务只复制已公开的允许字段和 Skill 文件；凭据留空，
  stdio MCP 待目标账号管理员填写本机命令。
- `studio/apps/audio_annotation/` 管理账号级录音标注任务，根项目直接保存 `owner_user_id` 并引用
  公共文件库中的音频；说话人/片段文档与最多双声道的预计算波形分别使用独立 revision CAS，
  选中片段可通过统一语音识别适配器执行一次性转写。识别参数、语言能力、文件上限和安全错误
  映射归属 `capabilities/transcription/`，录音标注、模型测试和 Galgame 只依赖该能力边界。
  删除任务不会删除原音频，被任务引用的音频不能从文件库删除。
- 应用目录同样由 Web 静态注册表维护， 应用最近访问记录只保存在浏览器本地。视觉创作工坊、
  Galgame 工坊、视频剪辑工坊、演示工坊、思绪工坊与录音标注工坊通过应用模块配置品牌、导航和 active 规则，共用 `app/layout/WorkshopShell`；侧栏展示由 `shared/ui/WorkshopSidebar.tsx` 统一拥有，
  包括品牌、返回卡片、图标导航和主题切换。思绪工坊复用该展示组件，知识库状态与目录仍由功能模块管理；录音标注工坊与演示工坊同样 `supportsProjects: true`，但只引用公共文件库、不拥有独立项目存储根。
  `web/src/features/interview-assistant/` 拥有面试助手，入口为 `/apps/interview-assistant`，复用应用壳。`api.ts` 与 `queryKeys.ts` 消费生成契约并按账号／账号区分缓存；`usePreparation.ts` 管理场次恢复、原件提交和真实进度；`PreparationPanel.tsx` 与 `BundleView.tsx` 展示资料版本、来源和问题依据。`Practice.tsx`、`session.ts`、`useInterviewSession.ts` 管理仅本页内存中的文字练习与规则复盘，固定使用已验收资料的首轮问题；不采集音视频。`assets/` 中的候选人为生成的虚构示意图，使用 Git LFS。
  `backend/studio/apps/interview_assistant/` 拥有私有场次、材料、输入快照、Codex 准备任务和交付契约；`routes/` 只适配 HTTP，`rooms.py` 执行权限、回执和 CAS，`runner.py` 通过现有 Runner 生命周期串行执行准备、处理中断并拒绝过期结果。`codex.py` 白名单读取模型连接、冻结上下文并消费 JSONL；`task_tools.py` 是不依赖运行时配置、ORM 或 HTTP 的文档／草稿 MCP，`process_watchdog.py` 负责父进程退出和超时终止。二者经 `scripts/website/interview_tools.py` 独立打包为 `fpl-interview-tools`，不复用服务进程凭据。`console/governance/interview_executor_access.py` 提供后台账号／成员权限重验，在主入口注入执行器。
  后端 `capabilities/asset_store/` 负责公共文件元数据、文件夹、存储校验、项目引用，以及三个工坊创建/删除时数据库与
  文件目录的一致性补偿，
  `apps/visual_workshop/` 负责真实项目、revisioned 节点画布、项目对话与图片/视频异步生成任务，
  `apps/galgame_workshop/` 负责 Galgame 工程元数据、Story 1.4 故事文档 CAS、账号级旧 Story
  批量迁移与旧文件导入用例、剧情对话富文本、多人角色舞台演出、
  角色/多层场景/音视频素材生命周期、虚拟打包路径、语音识别任务、立绘尺寸快照恢复、Fragment 线路分析与
  只读 Story 快照驱动的视频导出与分层剪辑交接任务，
  `apps/video_editor/` 负责与 Story 解耦的微秒级多轨文档、类型化原子操作、项目素材快照、代理媒体、
  后端精确停帧和剪辑任务；`apps/motion_compositor/` 拥有特效项目、素材、文档 CAS、工程包、导出任务与显式剪辑交接，浏览器界面归 `web/src/features/motion-compositor/`；`capabilities/media_rendering/` 统一拥有 RenderPlan 契约、特效 RGBA 帧求值、文字排版与透明图层、共享 `assets/` 固定中文字体、确定性帧求值、固定帧网格的
  FFmpeg/Pillow 合成和取消控制。`animated_image.py` 拥有有界、可取消的 GIF 单次动画到无声 MP4 转换；`media_rendering/gif_upload.py` 处理上传动画的临时输入，转换完成后才进入既有素材／输出 CAS 事务。`video_sampling.py` 按源视频 PTS 选择包含当前时刻的画面区间，
  精确停帧与导出共享该采样规则。正式剪辑渲染只依赖不可变时间轴快照和原素材，
  `spin_blur.py` 拥有旋转模糊的角向采样；Web 的 `video-editor/spinBlurCanvas.ts` 使用相同的角度、采样数与覆盖缩放，`VideoEditorEffectImage.tsx` 复用图片和文字图层的已加载素材。
  `directional_transitions.py` 拥有甩镜九点方向采样与漏光滤色配方；Web 的 `video-editor/directionalTransitionCanvas.ts` 对齐像素规则，`VideoEditorLightLeak.tsx` 在节目画布上只叠加一次光带。`video-editor/transitionCatalog.ts` 维护可复用转场的分类、名称与默认时长，面板和检查器共同消费。
  `media_rendering/timed_effects.py` 拥有复合片段内定时视觉脉冲，不改变素材采样或片段区间；`video_editor/timed_effect_edit.py` 在裁剪、分割和变速时维护局部区间及原始变化阶段。Web 的 `video-editor/timedEffects.ts` 与 `timedEffectsCanvas.ts` 对齐求值和像素处理。
  不启动 Chromium、Playwright 或浏览器录屏；Pillow 只承担文字透明层和二维像素合成，音频 PTS
  与最终封装由 FFmpeg 统一处理。
  均不预置项目或素材。Studio 一级
  “文件管理”和项目素材浏览器复用同一文件 API；Galgame 上传图片、音视频与字体也复用公共存储、内容签名和媒体元数据校验，
  但只能通过 Galgame 工程素材 API 修改或删除。`capabilities/asset_store/document_references.py` 统一检查文档与知识库封面的公共文件删除保护。公共文件被视觉或 Galgame 工程引用期间禁止删除，
  对话消息引用的项目素材也必须先解除引用才能删除。

视频剪辑的节目监视器由 `VideoEditorPreview.tsx` 装配；`VideoEditorMediaLayer.tsx` 拥有媒体图层与图片显示，
`VideoEditorProxyVideo.tsx` 在定位和源区间校验完成后发布代理视频帧，保留画布上的上一张有效画面，
`previewGeometry.ts` 共用素材适配与图层样式，`previewClock.ts` 统一媒体时钟纠偏。
`previewPlayback.ts` 为相邻视频片段维护显示缓冲身份，连续源区间自由播放，跳剪重新定位；
视觉转场实际连接的两个片段使用独立播放器，转场前后的普通切镜继续复用缓冲，真实空隙清空该缓冲。
后端 `apps/video_editor/runner.py` 由装配层分别注册 media 与 export 两个独立串行轮询通道，
素材预处理不等待长导出完成；每个通道只恢复自身中断任务，并分别参与后台健康检查。
`VideoEditorPreciseFrame.tsx` 保留已解码画面直到当前请求加载完成，工程与保存版本变化时清空缓存画面。
`transformModel.ts` 拥有变换几何、当前时刻求值与逐属性编辑操作，`usePreviewTransform.ts` 拥有指针手势、
临时草稿和提交取消，`VideoEditorTransformBox.tsx` 显示固定屏幕尺寸操作手柄。
`VideoEditorTransformFields.tsx` 将同一编辑契约接入属性检查器；草稿经编辑器显式传给预览与检查器，
不进入持久时间线。媒体层按画布裁切，操作框独立覆盖精确帧；所有写入仍经过时间线 CAS 保存队列。

视频剪辑的 `clip_merging/` 拥有连续视频片段选择校验、不可变任务快照、透明素材生成与原子替换规则。共享媒体渲染器提供显式透明画布与 ProRes 4444 输出；合并结果经代理就绪和规格校验后发布，替换与撤销通过时间线 CAS 操作执行。`VideoEditorClipMergeDialog.tsx` 拥有提交、进度、取消和当前编辑会话内的替换，任务中心只展示与取消任务，不自动修改时间线。项目名称编辑由 `VideoEditorProjectTitle.tsx` 拥有。

视频剪辑时间线工具栏由 `VideoEditorTimelineTools.tsx` 拥有；`timelineGaps.ts` 检测可见画面轨的内部微秒空隙，
`gapEditPlan.ts` 规划延长与前移的关联片段最终状态，`gapFreeze.ts` 规划和准备显式定帧素材。
`VideoEditorGapPanel.tsx` 拥有筛选、选择、定位与提交前版本复核；整批复用既有原子操作、音频转场协调、
撤销历史与 CAS 保存队列，不改变吸附、波纹删除或变速跟随的语义，也不检测素材内部黑帧。

- Galgame 视频导出按 `video_export_planning.py` 路线/片段/试片纯规划、`video_compiler.py`
  冻结 Story 到共享 `RenderPlan` 的编译、`video_compiler_events.py` 的绝对时间状态归约、
  `video_compiler_support.py`/`video_actor_compiler.py` 的舞台、序列帧与组合动画投影、
  `video_lip_sync.py` 的离线音频包络和确定性口型事件，以及 `video_dialogue.py` 的对白图层生成，
  `video_export.py` 用例和 `video_export_runner.py`
  后台执行拆分。直接导出与 `video_handoff.py`/`video_handoff_runner.py` 创建的分层剪辑工程共用
  同一编译结果；中文对白使用随应用分发的固定 Noto CJK 字体，正式成片只经过后端像素合成与
  FFmpeg，不启动网页、Chromium 或实时播放器。
  广播剧导入由 `annotation_import.py` 负责预检和任务
  用例，`annotation_import_runner.py` 将预检、FFmpeg 裁切、内容验收、文件落位、Story 结算与
  自动补偿保持为独立阶段。HTTP 路由不直接依赖
  Runner，应用生命周期只装配 Runner 模块。
- Galgame 素材写入和 CAS 用例保留在 `assets.py`；文件命名、媒体元数据映射等纯规则位于
  `asset_support.py`，引用分析、资源总览和打包清单位于 `asset_analysis.py`，避免 CRUD、Story
  遍历和打包投影继续共享一个大型类文件。
- 视觉助手对话生命周期与发送事务保留在 `visual_workshop/assistant/conversations.py`，附件权限、
  内容投影、图片编码和文档提取集中在同目录 `attachments.py`，避免会话持久化依赖具体媒体解析。
- 版本化项目快照的 ZIP64 流式校验、临时文件清理和跨平台目录打开命令由
  `capabilities/asset_store/project_snapshots.py` 与 `capabilities/asset_store/project_folders.py` 拥有；画布、Story 和时间线的
  类型化投影、ID 重映射与模型语义匹配仍位于三个所属工坊。
- `runtime/project_records.py` 只提供显式账号谓词下的项目加载、revision CAS 更新和删除
  原语，不自动提交事务也不承载默认文档、就绪状态、快照投影或领域错误规则；三套工坊继续拥有各自
  用例。Web 的 `shared/ui/project-library/useProjectLibraryController.ts` 通过功能适配器统一项目列表、
  创建、改名、删除、快照导入导出、缓存和错误恢复，不依赖任何业务 feature。
- Web 的依赖方向是 `app → features → shared/platform/generated`。`platform/` 与 `shared/`
  不依赖 `features/` 或 `app/`，`features/` 不依赖 `app/`；入口装配留在 `app/`，业务代码不
  放回 `web/src/` 根目录，生成契约不手工修改。
- `features/models/queryKeys.ts`、`features/visual-workshop/queryKeys.ts` 与
  `features/audio-annotation/queryKeys.ts` 是各功能缓存键的唯一 owner；跨功能调用只复用 factory。
  `platform/api/useApiBlobUrl.ts` 统一鉴权预览请求的取消、竞态保护和 Object URL 回收，带独立缓存、
  重试预加载或多音轨调度的媒体运行时继续由所属 feature 管理。`shared/ui/project-library/` 只拥有
  项目卡片、快照导入/导出/目录按钮、重命名/删除对话框和无业务 API 依赖的集合更新规则；
  `shared/media/` 只拥有浏览器侧通用帧捕获、图片编码与安全文件命名，不持有项目 API。
- `features/accounts/` 拥有账号治理、个人资料与安全、平台账号页面和账号 API/Mutation；
  `app/StudioSession.ts` 只提供 Session Context，认证与业务请求统一经过 `platform/api` 客户端。
- Character 账号的 ViewModel 由独立 `character账号ViewModel.ts` 拥有，展示子面板不再
  反向导入总视图。Galgame 样式由 `galgameStyles.ts` 懒加载编辑器壳、Story 编排、角色舞台和
  素材/播放器四个语义包；源码在各语义所有者下继续按 foundation/components/interactions 拆分，
  不使用编号分片。构建预算只读产物，单 CSS 不超过 150 KiB、单懒加载 JS 不超过 500 KiB，
  Galgame CSS 总量以重构前 369,600 bytes 为基线至少降低 10% 并禁止回升。
- Galgame 编辑器内部以 `story-authoring/`、`timeline/`、`characters/`、`visuals/`、`audio/`、
  `preview/`、`presentation/`、`assets/` 为语义边界，各目录的 `index.ts` 是内部稳定入口；根目录
  同名旧文件只承担兼容转发或页面编排。Block 设置与 Inspector 均按文字、舞台、媒体、流程和系统
  家族维护，时间轴、角色与视觉工作区把交互 Hook、业务 mutation、派生 ViewModel 和视图分开，
  不允许把拆出的内部状态重新摊平成跨模块共享的巨型返回值。
- `web/src/docs/` 是独立文档入口的数据与展示边界。`articles/` 按能力维护唯一的 Markdown
  使用正文，`content.ts` 与 `types.ts` 维护分类、分组和应用/工具上下文；开发者与 API 分类直接
  加载仓库已有 Markdown，不保存副本。`legacyLinks.json` 显式映射拆分后的旧章节。
  阅读器从正文派生二三级目录、全文搜索和复制内容，保留 `docs.html?page=...#section`、前进后退、
  主题与移动端抽屉。配套截图及逐图来源只存于 `web/public/docs/`，不作为产品状态或测试数据源。
  `web/scripts/documentation-coverage.mjs` 从正文与来源清单生成文章覆盖表；文档结构回归在
  `web/tests/docs-content.test.ts`，浏览器阅读旅程在 `web/e2e/docs.spec.ts`。
  使用指南同时覆盖 Live2D、桌宠、导演台与特效制作；`articles/creative/` 拥有创意发布与安装，
  `articles/desktop/` 保留稳定文章路径，正文拥有网站运行、CLI 接入和 Amadeus 页面侧栏操作说明。覆盖脚本发现全部使用正文，
  未登记入口或缺少核验依据时失败；组件测试比对实际应用注册表，防止新增应用遗漏指南。
  `rendering/` 移植 Sayflow 的静态文档树、受控组件与阅读样式，支持步骤、卡片、参数、输入输出、
  高亮代码、公式和 Mermaid；通过研究所主题、URL 与 API 操作适配器集成，不执行文章中的 JavaScript。
  组件契约、所有公开正文编译和渲染回归在 `web/tests/docs-rendering.test.tsx`，纳入 `npm run docs:check`。
- `scripts/demo/galgame_runaway/performance_upgrade.py` 只保留兼容入口、CLI 和流程编排；稳定演出规格、素材上传、
  Story 变换/演出块、审计报告与 API/CAS 辅助分别归属同目录 `performance_assets.py`、
  `performance_spec.py`、`performance_transform.py`/`performance_story.py`、`performance_audit.py` 和
  `performance_http.py`，旧函数入口通过兼容重导出继续可用。
- Web 组件和 E2E 测试按编辑器作者工作流、时间轴/角色、音频/舞台、播放器表现、画布助手和分支旅程
  等领域行为拆分；共享 mock/data builder 保留在所属测试能力内。测试文件不使用编号分片，单文件
  不超过 1,200 行，尺寸豁免基线保持为空。
- `.github/workflows/` 使用锁文件安装依赖：后端验证 Python 3.11 与 3.14，Web 使用 Node.js 24，
  Chromium E2E 使用隔离临时数据库和确定性 fixture，不携带真实供应商凭证。CI 检出默认不下载
  文档演示图，只为后端、Web 和 E2E Job 选择性拉取各自运行资产，并独立检查 LFS 指针完整性。
- `.agents/notes/` 只保存工程决策的 why/alternatives/consequences/verification；产品文档中心正文仍由
  `web/src/docs/` 拥有，文档中心配图仍由 `web/public/docs/` 拥有，SDK/API 文档生成入口为
  `scripts/generate_sdk_docs.py`，这些内容不能通过 Note 整理迁移或改写。
- 根 `/health`、`/ready` 是无版本探针，其他业务路由由统一的 `/v1` router 注册。
- `console/governance/` 负责账号用例；请求通过 Cookie Session 或绑定单一账号的
  Management API Key 生成 `StudioPrincipal`，`deps.OwnerDep` 只从该 Principal 派生租户 ID。
  业务模块不使用 ContextVar 或 `default` 回退；后台任务从持久任务记录恢复账号，缺失归属
  立即失败。HTTP 上传在路由层适配为 `files.IncomingFile`，业务模块不依赖 FastAPI `UploadFile`；
  `AssetStorage` 项目路径与写入方法要求显式 `owner_user_id`，`path_for(asset)` 只读取已验证资产归属。
  管理员不具有他人私人资源访问权。

## 数据与运行边界

数据库是仓库根目录 `.runtime/future-props.db` 下的单机 SQLite 文件，也是项目状态唯一真源。
部署仍是单进程、单 SQLite，私人数据按 `owner_user_id` 隔离，管理员也不能跨账号读取。
文件统一保存在 `accounts/<user-id>/`，头像位于 `profiles/<user-id>/`；账号目录下包含 `applications/`、
`library/assets/`、`model-test/`、`model-inference/`、`integrations/` 等对应业务路径。
`db/migrations/versions/account_ownership/` 保存 `0116_account_ownership` 的静态分组 SQL；
`capabilities/asset_store/upgrade_records.py` 保存升级清单，`account_upgrade.py` 执行可恢复文件复制与校验。
迁移未完成时后台执行器暂停，管理员通过正式布局 API 完成核验并重启。旧根目录只作恢复副本，正常路径无回退。
`runtime/ownership.py` 拥有显式账号 ID 校验与 session 绑定原语，`orm.py` 负责行级过滤和写入归属校验。
Skill 的可编辑标签保存在 `integration_skills.tags`，与目录配置共用 revision/CAS，
不属于内容版本；文件存储显式使用已鉴权账号。
集成中心前端的 `features/integrations/queryKeys.ts` 统一管理目录、详情、版本与工具列表缓存；
`IntegrationInteractions.tsx` 和 `interaction.ts` 拥有草稿保护、外部更新与页面定位回执。
自动化操作登记表逐项开放现有集成 API；目标校验归属 `console/governance/automation.py`，不开放任意 URL
或系统命令。工具 API、MCP 和校验记录用例显式接收已鉴权账号。

Skill 不可变版本保存在 `accounts/<user-id>/integrations/skills/<skill-id>/<version>/`。
创意工坊封面、Skill 草稿与公开版本分别保存在
`accounts/<user-id>/creative-workshop/{covers,skill-drafts,skill-releases}/`；
目标账号安装后的 Skill 副本回到其 `integrations/skills/`。备份数据库时必须同时保留
整个 `accounts/` 树，才能恢复创作封面、公开 Skill 版本和安装副本。
`.local/interview-room-prototype/` 保存面试室的独立前端交互原型、模拟任务与对话状态、生成的示意图和浏览器验收证据；不注册生产路由，不接入后端、外部 Agent、真实检索或音视频采集，刷新即清空本次记录。
本地临时分镜、场景图、导出结果、下载与研究草稿统一放在仓库根目录 `.local/`
（`scratch/`、`output/`、`tmp/`、`downloads/`、`research/`），与 `.runtime/`
一样被 git 忽略，不进入文档资产或产品素材真源。FastAPI 启动时自动创建
目录并执行 `registry.py` 中已登记、带 checksum 的 migration；每个连接启用外键约束、WAL
与忙等待。迁移历史只追加且不导入运行时 `app`，schema 变化必须同时更新 ORM、注册表、测试
和文档。`r0019_project_storage_layout` 只增加存储版本；旧文件由受鉴权的显式迁移 API 校验并搬迁，
schema migration 不执行文件 I/O。

目录配置、模型测试会话与生成任务、视觉工坊项目、含节点级生成草稿和动态连线的节点画布、项目对话、文件夹、文件和项目引用
使用 revision/CAS 防止静默覆盖；Galgame 工坊工程元数据与整份故事文档分别使用 revision/CAS，
故事冲突保留服务器完整快照，完成态工程在故事修改后恢复草稿。Story 1.4 的角色、素材、国际化、
时间轴、流程与表现层交叉校验由 `apps/galgame_workshop/schemas/story_validation.py` 的纯函数拥有；
旧 Story 1.0–1.3 的格式转换只由
`apps/galgame_workshop/schemas/story_legacy.py` 适配器拥有；`apps/galgame_workshop/story/story_migrations.py`
通过正式 `/v1` API 执行状态预检、受账号约束的批量 CAS 固化和单工程旧文件导入，不以
schema migration 或直接数据库修改替代运行期迁移。工具单项状态通过幂等更新和原子 upsert 写入。图片/视频/音频生成任务持久化
供应商/模型快照和规范化参数，FastAPI 生命周期中的单机执行器负责恢复、轮询与安全下载；视觉工坊
和模型测试复用 `runtime/polling_runner.py` 的生命周期与并发控制，并由
`llm/generation_runtime/GenerationTaskDriver` 统一编排 queued、submitting、pending、processing
与终态转换、重启恢复及安全失败；两者分别提供任务存取、调用日志、素材组装和结果落盘钩子。
`llm/task_execution.py` 定义供应商无关的可选执行信息，由驱动器短事务持久保存；
`llm/providers/zealman_progress.py` 与 `zealman_live.py` 归一化队列、账本和任务身份匹配的实时事件。
实时连接由具体执行器拥有，断线回退 HTTP，不参与终态结算；前端共用
`shared/ui/taskExecutionPresentation.ts` 区分节点采样进度与上游报告值。
`submitting` 中断不会自动重提，以避免重复计费。`AsyncSession` 只能由单个异步任务
使用；每个生成分支使用独立短会话，供应商网络调用和文件下载不占用已开始写入的事务。
项目对话同样在发送准备与流式结算阶段使用独立短事务，并复用统一供应商适配边界。视觉工坊
Agent 是通用 Harness 的首个消费者：读取画布、素材和生成任务无需确认，画布写入和外部生成必须
经过内存审批；工具步骤持久化到对话消息，运行和审批等待不持久化，服务重启会安全取消遗留状态。
写工具复用视觉工坊校验与短事务，批量节点/连线变更只执行一次画布 CAS，生成任务与占位节点原子创建，
且不与 `model_test_*` 数据混用。

模型测试对话、图片附件及生成结果是独立的账号调试数据，不进入视觉
工坊文件管理，也不参与 Bot 或业务编排。启动恢复会把遗留的 pending 模型回复标记为 cancelled。
`0119_retire_model_test_tools` 删除已下线的 Mock 工具定义、会话绑定和专用调用记录三张表，
保留对话、消息与已有模型调用日志。`llm/call_logs/` 根据日志中已有的脱敏请求快照
按需生成不含凭证的临时复现 ZIP，不新增持久化副本；只有具备完整纯文本输入的供应商协议可导出。
实时语音通话不建立持久化会话，转写和音频只在浏览器与连接内存中存在，调用日志
仅保存时长、字符数、延迟、usage 与状态。当前工程包含单机账号和逻辑多账号，但仍刻意不包含
Bot 会话、知识库、电话接入、浏览器扩展或多实例租户部署。

## 按需扩展

Sayflow 的 PostgreSQL、多实例 worker、扩展、共享 runtime 包、知识库、评测仓和部署体系不属于
当前架构。只有出现至少两个真实消费者或明确交付需求时，才创建 `packages/`、`extension/`、
`evals/`、`deploy/` 等目录，并同时补充本索引、运行命令和架构测试。

## 思绪工坊

后端 `multitable/` 拥有多维表格的独立 ORM、类型化契约、字段转换、受控 SQLite 查询、原子批次、CSV、差量历史及 version 9 备份重映射；人员、填色条件和字段编组写在现有表、字段与视图 JSON 中。`content.py` 投影当前数据用于静态导出。`routes/multitable.py` 适配账号 API；`publication/tables.py` 在独立会话分别校验父文章与目标表格授权，`routes/community_tables.py` 与社区路由一起装配，避免继承普通账号权限。文档根 `ThoughtNote.kind` 默认 note，子实体通过已验证根继承账号与生命周期。

Web `features/thought-workshop/multitable/` 拥有 TanStack Table/Virtual 网格、看板、月历、字段/视图配置、记录编辑、CSV、历史、嵌入节点和静态内容导出；所有缓存键继续由现有 `queryKeys.ts` 维护。`useTableDocument.ts` 合并连续编辑、串行提交并保存按账号/访问上下文/文档/标签页隔离的 IndexedDB 待保存操作；`saveLane.ts` 协调当前页面的提交顺序，服务器 CAS 判定跨标签页冲突。当前表、视图、滚动位置与侧栏折叠是个人阅读状态，视图配置是共享文档数据。`Navigation.tsx` 拥有容器响应式数据表导航和视图标签，`Toolbar.tsx` 通过回调提供配置与记录操作；`ColumnResize.tsx` 只在拖动结束提交列宽，嵌入网格在目标可编辑时用同一提交写回源视图，未保存过的列宽按嵌入宽度分配。`FieldValue.tsx` 显示主题安全标签。`PersonField.tsx` 选择当前空间成员，`ColorRuleEditor.tsx` 与 `colorRules.ts` 编辑并套用填色条件，`FieldCatalog.tsx` 管理字段列表和编组，`columnBands.ts` 计算表头编组跨度。`ViewSettings.tsx` 保存一份跨页签草稿；`FieldForm.tsx`／`FieldEditor.tsx` 共用类型配置并拥有表头浮层，`field-settings.css` 拥有对应布局；`formatting.ts`／`fieldChanges.ts` 分别拥有展示投影与草稿合并；`grid.css` 拥有网格和单元格呈现，`embed.css` 拥有笔记内嵌入块的排版，`multitable.css` 拥有导航、其他视图与弹层样式。

`publication/` 拥有同部署知识社区的发布、目录过滤、逐篇授权、收藏和素材访问；`routes/community.py` 仅做浏览器 Session 协议适配。发布记录直接保存源账号，成员授权仅作用于已发布文章。`Community` 为每次操作创建独立会话，授权后显式绑定源空间调用 `Notes`；写入采用短事务串行化权限检查、撤回与正文 CAS。`lifecycle.py` 在源回收站事务内关闭文章或整库，恢复不自动重新发布。迁移 `0082_thought_publications` 只建发布表，不复制正文、不自动公开现有内容。

Web `community/` 拥有精选书架、发布与权限弹窗及社区阅读入口；`DocumentAccess.tsx` 是普通与社区保存、引用、上传、素材读取和导出的显式适配接口。`KnowledgeSidebar`、`KnowledgeTopbar`、`NoteReaderPane` 统一目录、顶栏和富文本阅读布局；官方与普通发布使用同一富文本阅读器，旧地址由授权后的发布映射解析。社区缓存、草稿和阅读位置按账号及发布资源隔离，权限失效停止保存并保留本机草稿。搜索、计数、反向链接与导出只返回可访问的当前文章，隐藏父文档的子文章提升到可见目录顶层；未发布首页使用社区简介。

`DocumentOutline`、`outlineHeadings.ts` 与 `useDocumentOutline` 负责从当前编辑器提取章节、
左侧留白布局和滚动定位；`document-outline.css` 拥有常驻目录及窄屏浮层样式。
目录及临时展开折叠内容只属于界面状态，不写入正文或修改 revision。

`apps/thought_workshop/link_preview.py` 拥有匿名公网网页元数据读取及连接地址校验；
`LinkPreviewCard`、`useLinkPreview` 与 `useLinkPreviewPosition` 在编辑和只读正文共用悬浮交互，
样式归 `link-preview.css`。预览不进入正文或数据库，缓存键由 `queryKeys.ts` 按账号和 URL 管理。

文档历史由 `apps/thought_workshop/history.py` 拥有快照与分页，`history_archive.py` 拥有备份历史校验和重映射；`notes.py` 在正文 CAS 事务中记录与还原内容。迁移 `0049_thought_history` 为现有文档建立作者未知的历史起点，历史附件独立引用并参与公共文件删除保护。历史全部保留，文档永久删除时级联释放。

Web 的 `NoteHistory` 复用现有只读 `RichEditor`；`historyDiff.ts` 负责有界块对齐与文字差异，`HistoryDecorations` 仅在预览中叠加标记，`history.css` 拥有列表和修改痕迹样式。历史模式不修改编辑草稿，唯一历史缓存键仍由 `queryKeys.ts` 维护。

`apps/thought_workshop/knowledge_tools/` 拥有引用索引和解析、SQLite 检索、独立模板与原子子树复制、历史命名标记、账号偏好及一致导出快照；`archive.py` 拥有 version 6 模板与标记的校验和重映射。`routes/knowledge_tools.py` 只做协议适配。新增表由 `0080_thought_knowledge_tools` 登记，不改变旧迁移。

Web `knowledge-tools/` 拥有引用与提示块节点、查找替换、跨库发现、模板与复制对话框、关联文档、阅读位置和整库 HTML 打包；`drafts/storage.ts` 以账号、文档、标签页隔离 IndexedDB 草稿。`useNoteResults.ts` 统一编辑和只读入口的 40 条分页。个人状态经 Principal 访问，官方正文也是已发布笔记；阅读偏好不修改正文。画板 version 2 的确定性锚点、文字和连线路径归 `diagrams/model.ts`，React Flow 只承载交互。

`backend/studio/apps/thought_workshop/` 拥有文档项目、目录、正文、回收站与文件备份。这里的「知识库」是文档项目容器的名称，不提供模型检索或文件内容解析。普通目录沿用账号权限，社区发布有明确的逐篇授权边界。

- `knowledge.py`：知识库元数据、封面归属、首页创建、库级 revision/CAS、整库删除与恢复。
- `directory.py`：库内嵌套文档树、移动排序、循环校验；移动正文归属时推进文档 revision。
- `notes.py`：显式知识库归属下的正文读写、自动保存冲突快照、文件引用投影。
- `attachments.py`：附件上传；公共类型与签名校验由 `capabilities/asset_store/policy.py` 拥有。
- `portability.py` / `archive_structure.py`：v3 备份的预检、磁盘暂存、短事务与失败补偿。
- `legacy_import.py`：唯一的 v1/v2 备份转换边界。生产读写没有旧笔记本模型、接口或默认知识库回退。
- `schemas/document.py`：无业务依赖的富文本允许列表、搜索文本与文件引用投影；正文保持 v2。

`web/src/features/thought-workshop/` 拥有知识库卡片、首页阅读与编辑、多级目录、保存队列、格式转换与唯一 `queryKeys.ts`。AI 写作仅经后端 API / SDK / Agent skill 接入，应用内无入口。`KnowledgeSidebar` 将库切换、搜索、直观筛选入口和独立滚动目录融入旧版侧栏；筛选结果在右侧显示，离开编辑器前沿用保存保护。`KnowledgeTree` 提供拖动与键盘菜单；旧笔记 URL 只根据文档 ID 跳转到包含知识库 ID 与文档 ID 的新地址。共享项目卡片的可选封面与元信息保持其他应用默认行为。

样式按职责分为 `knowledge.css`（项目列表与知识库布局）、`knowledge-results.css`（全部文档 / 最近编辑等筛选列表）、`thought-workshop.css`（保存冲突等）、`writing-layout.css`（编辑布局与标签）、`editor.css`（正文与工具栏）、`attachments.css`（文件卡片），所有覆盖限定在思绪工坊。共享侧栏样式位于 `shared/ui/workshop-sidebar.css`；`CustomSelect` 默认使用自绘顶层菜单避开目录滚动裁切，并根据可见视口向上或向下展开，保留原 DOM 焦点范围。

根知识库与文档显式保存账号；子目录继承已验证的知识库归属。所有请求通过 `OwnerDep` 获取租户，模型注册中的租户过滤仅作额外防护。正文使用文档 revision，目录与库元数据使用库 revision，跨层修改在同一短事务中完成。

`thought_note_assets` 保护正文图片和附件，知识库封面通过外键与文件库用例保护，包括回收站。迁移 `0046_thought_knowledge_bases` 将每个有旧数据的账号转为「我的知识库」，旧笔记本成为顶层文件夹，移除旧表与字段，保留文档 ID 和所有内容。空空间不创建默认项目。迁移无运行时 app 依赖，并已在隔离数据库验证后登记。

`studio/apps/thought_workshop/storage/migration_documents.py` 按账号导出并原样恢复知识库、文档及历史、个人状态、表格及日志、发布配置与逐篇授权。维护入口由 `studio/assembly/independent/thought_workshop/maintenance.py` 装配。`migration_relationships.py` 核对文档树、表格历史、重建索引和素材链接摘要。`studio/contracts/thought_workshop/migration.py` 定义独立 Assets 维护入口接收的四类素材投影。

## 前端屏幕适配

`shared/ui/ResponsiveSidebar.tsx` 拥有主控制台与普通工坊的单实例抽屉外壳；品牌、业务导航和账号入口仍通过原组件提供。`ViewportBounds.tsx` 同步可见视口高度和偏移，供软键盘出现时的面板与菜单约束使用。`useDrawerFocus.ts` 统一抽屉/弹窗的键盘范围与焦点恢复；`CompactPanelTabs` 仅提供面板切换展示，不拥有编辑器实例、文档或播放状态。`QueryFeedback` 展示加载失败及重试。

视频、Galgame、录音标注与模型测试的布局状态和适配 CSS 留在各自功能目录。Galgame 的独立预演也保留舞台、台词队列和检查器，布局规则由 `editor/fast-preview-compact.css` 拥有。紧凑面板通过 CSS 控制可见性，切换屏幕尺寸不重建业务控制器。思绪工坊侧栏背景随整页延伸，内部导航固定在可用视口。全站不使用根级横向溢出隐藏代替宽度修正。

`web/e2e/responsive-inventory.ts` 维护全部应用路由与独立入口的适配归属；`responsive-site`、`responsive-editors`、`responsive-panels`、`responsive-states` 分别负责入口、编辑工作区、账号/登录/模型子面板及请求状态矩阵，`responsive-forms` 检查表单及嵌套菜单。`responsive-capture.ts` 检查页面宽度和可见弹层边界并保存实页截图。`web/tests/responsive-coverage.test.ts` 对路由联合类型与 HTML 构建入口执行遗漏检查；`viewport-bounds.test.tsx` 验证模拟可见视口收缩时的菜单定位及监听清理。验收记录见 `docs/reference/responsive-verification.md`。

## 平台治理补充职责

- `console/governance/settings_records.py` 读取持久设置，`platform_settings.py` 拥有配置 CAS，`registration.py` 拥有邀请码名额和注册事务。
- `model_templates.py`、`model_template_sync.py` 拥有角色模板、预览和逐账号持久同步；保留自建资源，管理员预览不暴露私人目录名称。
- `code_agents.py` 按账号、Agent 与用途维护授权，连接定义和认证白名单属于部署 TOML。
- `runtime_quotas.py` 拥有账号与实例额度，`generation_queue.py` 维护图片／视频等待容量及任务调度；等待不占并发，额度领取与提交状态在同一短事务更新。
- `developer_docs.py`、`project_certification.py` 拥有开发者文档与官方标记；私人数据没有管理员跨账号读取入口。
- `demo_services.py` 维护固定演示服务，`demo_runtime/` 只实现进程内 Mock；`llm/catalog/defaults.py` 保存账号默认模型，并与目录共用 CAS。
- `web/src/features/accounts/` 拥有账号设置、中台六个页面、注册邀请码、模型模板、Agent 分配与运行额度。
  调用日志的工具栏、筛选、列表与缓存由 `features/models/logs/` 拥有，只查询当前账号。
- 旧空间治理、成员授权、公开展台、跨空间日志及动态权限策略模块已删除。迁移 SQL 仅保留历史兼容名称。

## 演示工坊

`backend/studio/apps/presentation_workshop/` 拥有文稿项目、图片归属校验、引用同步和请求内导出。
`templates/` 拥有账号模板／完整示例、素材引用、v4 页面语义与模板快照、纯解析器以及显式绑定预览事务。`schema.py` 不依赖文稿或数据库；`schemas/elements.py` 拥有模板与文稿共用的原生元素契约，`templates/scenes.py` 保存 v2 原生场景、动态语义和 v5 页面版式关联；`native_scene.py` 统一重映射分组与连线，`layout_application.py` 只按明确映射向指定页面转移几何／可选文字样式；`legacy.py` 保留旧槽位覆盖。`resolver.py` 生成临时模板层，`binding.py` 按文稿与目标模板 revision 校验后应用，保留正文与文稿覆盖。`library.py` 管理模板／示例 CAS 与入门包原子导入。迁移 `r0111_presentation_templates` 仅追加模板、示例及各自素材引用表，不回写旧文稿；`r0112_presentation_native_templates` 只增加模板 v2 与文稿／示例 v5 的降级保护，不自动重排内容。

`projects.py` 处理账号限定加载与整体 CAS；`exports.py` 负责只读版本快照、
两路导出并发、私有临时文件和取消清理；`pptx_export.py` 组装 python-pptx 导出，`pptx_styles.py` 映射 DrawingML 样式，
`pptx_media.py` 拥有 SVG 扩展嵌入、PNG 兼容图与图片外观，`native_shapes.py` 构造可编辑自由形状。
文稿持久化于 `presentation_projects`，图片引用位于 `presentation_asset_references`。
迁移 `0057_presentation_styles` 为文稿 JSON 补齐确定性样式缺省值，不改变 revision 或更新时间；
`pptx_styles.py` 与 Web `PresentationShape.tsx` 分别拥有 DrawingML 和 SVG 样式映射。
格式控件拆分到 `PresentationShapeSettings.tsx` 与 `PresentationNumberField.tsx`。
迁移 `0056_presentation_workshop` 仅追加这两张表；图片沿用公共文件库并参与删除保护，
不增加独立项目素材目录或持久导出任务。API 不接收账号 ID。

`web/src/features/presentation-workshop/` 拥有文稿列表、模板与示例库、单页版式、DOM/SVG 页面渲染、
当前文本框 Tiptap 编辑、统一撤销、自动保存队列、元素变换、属性面板与放映。
`master/` 拥有独立路由的聚焦模板设计器、文稿绑定与覆盖面板、共享配置控件及 Web 纯解析器；`canvas/` 拥有原生模板图层适配、对象属性、手势历史与紧凑画布样式，设计器复用 `SlideCanvas` 的几何与吸附；`nativeScenes.ts` 明确转换旧槽位、解析固定场景并为新页克隆默认正文，`studioPreview.ts` 保存五种真实布局，预览和创建共用这些数据。`LayoutApplicationPanel.tsx` 负责选页、显式映射及双版本预览／应用；普通文稿固定层仍受保护。`web/public/presentation-templates/` 保存内置生成插画，`bundledAssets.ts` 仅在显式保存／导入时上传被引用素材并重映射为当前账号的托管 ID；`SlideSurface` 接收文稿上下文并解析模板，画布正文选择与修改仍使用源页面。全局模板变更进入原历史队列，预览应用通过正式 API 后保留撤销历史；新增模板页登记响应式验收。
`queryKeys.ts` 维护该功能缓存键；`SlideSurface` 被画布、可见缩略图和放映复用。
`exchange/ExportDialog.tsx` 统一 PPTX 主按钮与菜单入口，显示保存、预检、生成和文件保存阶段；
`exchange/export.css` 拥有不定量进度与可复制路径样式。生成文件仅在弹窗内存中暂存，取消或写入失败可以重新保存；
桌面通过固定导出桥接返回实际路径与定位回执，浏览器只报告下载交接，不声称文件已落盘。
`presentation-dialog.css` 统一工坊弹窗尺寸、控件密度和固定标题／操作栏；内容区局部滚动，各编辑器继续独立拥有草稿与焦点生命周期。
`presentationHistory.ts` 解析历史快照的页面与元素定位；`usePresentationDraft` 持有本次会话的 100 步历史与保存队列，`usePresentationHistory` 统一键盘、按钮、字段合并边界、输入法与未提交手势取消。历史定位和分组提示只存在内存，不进入文稿、HTTP 或 SDK 契约。
`codeHighlight.ts` 将 lowlight 语法树解析为现有原生段落与显式 run 颜色；`CodeHighlightDialog`
按需加载源码与预览，用户应用才更新当前文本框，保存和 PPTX 导出不依赖高亮 CSS。
`codeBlock.ts` 生成原生代码背景、语言标签和文本分组，工具栏插入复用现有片段、撤销与保存链路。
`scene/` 拥有原生分组、节点连接、参考图对照和页面检查；`infographics/` 拥有 AntV
声明式输入、受控模板原生转换与 ELK 布局，不持有另一套保存或导出状态。`elkLayout.ts` 按需创建并销毁独立布局 Worker，`validation.ts` 在原生片段预览前校验结构，装饰 SVG 复用正式素材预览校验。
`scene/selection.ts` 解析命中元素、完整逻辑对象框选与分组选择，`useSceneTools` 唯一持有组内层级；画布在点击松手时请求下钻，拖动保留原选区。这些选择状态不进入文稿持久化。
`scene/ConnectionPanel.tsx` 将连接属性停靠到右侧 `PresentationInspector` 元素页，连接选择与新建预览仍由 `useSceneTools` 拥有；不再持有浮层定位状态。
`scene/connectionGeometry.ts` 拥有沿边比例端点、旋转边缘投影、路径编辑与节点跟随；`ConnectionHandles` 展示画布覆盖层，`useConnectionDrag` 只持有可取消预览，松手经统一草稿提交一次。线身拖动解除两端绑定并平移全路径，端点拖动可自由放置或重新吸附；直线拖动保持直线，折线手柄编辑局部走线。自由端点以互斥的 ID／point 表达，`0104_presentation_free_connections` 为旧连接补 null 坐标，复制、可见性、批量操作和 PPTX 共享端点语义。后端 `connection_routes.py` 与 Web 共用测试向量，operations 合并整批节点变换后调整路径，显式路径优先。连接 `source_offset`、`target_offset` 为 0–1，迁移 `0100_presentation_connection_offsets` 为旧连接补 0.5，保留路径与 revision；PPTX 将非中点连接导出为自由形状以保留几何。
`scene/stacking.ts` 解析并调整元素与连接的统一前后顺序；连接 `layer` 保存下方元素数量，同层按连接数组顺序。迁移 `0098_presentation_connection_layers` 为缺失层级补 0，保留旧画面与 revision。`SlideSurface` 与 `pptx_scene.py` 消费相同顺序；PPTX 仅保留连续叠放的原生组，交错组在导出时展开以保持遮挡，源分组不变。
后端 `schemas/scene.py` 校验文稿 v3 的引用关系，`scene_edits.py` 拥有片段替换和身份重映射，
`slideTheme.ts` 拥有新建色板、可修改颜色收集与单页换肤纯函数，`SlideThemeDialog` 只维护预览替换表；用户应用才进入原草稿历史与 CAS 保存，不追加持久化字段。`useSceneTools` 返回动作描述与独立弹窗，`PresentationToolbar` 统一展示信息图与“更多”菜单，不再增加整排场景工具。`slide-theme.css` 仅维护换肤弹窗布局。
`pptx_scene.py` 拥有原生分组与端点绑定导出。迁移 `0096_presentation_scene` 为旧文稿追加空场景字段，
不改变原内容或 revision；参考图纳入账号素材保护但不参与放映与 PPTX。
页面 `image_asset_id` 单独保存一张归档图的公共素材引用，沿用同一 CAS、账号校验与删除保护。
迁移 `0097_presentation_image_version` 只为缺失字段补 null，不改变已有图像 ID、revision 或更新时间。
`SlideImageVersion.tsx` 拥有页面面板内的归档选择、上传、预览与下载，`slide-image-version.css` 维护其样式；
图像版本独立于参考图，不参与画布、缩略图、放映或 PPTX，不建立第二套保存状态。
结构类型来自 OpenAPI，缩放不改变文稿坐标。样式分别由 `presentation-library.css`、
`presentation-workshop.css`、`presentation-canvas.css`、`presentation-controls.css` 与 `presentation-selection.css` 维护，
分别对应首页、编辑器布局、画布渲染、交互控件与选区悬浮操作；移动端只做浏览及轻编辑。
`presentation-inspector.css` 拥有格式面板的分区与控件样式，`InspectorArrange` 拥有对齐和层级控件，
`useInspectorResize` 管理面板左边缘拖动、键盘调宽与工作区宽度约束，宽度仅作为界面状态。
`paragraphLists.ts` 统一段落列表选项与连续编号推导；`bullet` 与 `numbered` 互斥，迁移 `0099_presentation_lists` 为旧段落补齐未编号缺省值，保留文稿 revision。文字编辑、放映与 PPTX 使用相同的单层列表规则。
`PresentationToolbar`、`PresentationMenu`、`PresentationNotes` 与 `PresentationStatusbar`
拥有工具栏、键盘菜单、备注折叠和缩放操作，UI 状态不进入文稿数据。
`useSlideViewport` 拥有容器适应比例、捏合与修饰键滚轮缩放、鼠标或可视中心锚点和局部滚动补偿；
`SlideCanvas` 显式反馈手动比例并在元素变换或裁剪期间暂停手势缩放，视图状态不进入保存与历史。
`SelectionOverlay` 根据旋转后的屏幕选区定位悬浮栏，`SelectionToolbar` 按元素类型提供格式命令，
`useSelectionFormat` 统一整框与 Tiptap 选区格式，`selectionGeometry` 和 `SelectionHandles` 拥有八方向缩放及选框。
`layoutObjects.ts` 按当前分组范围解析逻辑对象、首选尺寸基准和排列命令可用性，整体分组不拆成成员对齐；
`layoutSnapping.ts` 拥有屏幕距离阈值、吸附保持、等距与约束缩放计算，`LayoutGuides` 与 `layout-guides.css`
只绘制临时辅助线。面板和悬浮菜单共用排列描述与提交入口，手势预览不持久化，提交沿用 `updateScene`、草稿历史和 CAS 保存。
首页基础版式创建复用 `templates.ts`；画布报告实际缩放比例，缩略图按容器宽度等比适配。
新增路由由响应式清单登记，浏览器流程位于 `presentation-workshop.spec.ts`。

演示工坊 v3 扩展按职责组织：`schemas/appearance.py`、`objects.py`、`paths.py`、`annotations.py` 与 `playback.py` 拥有专属结构；`asset_references.py` 收集背景、填充、封面和媒体等实际引用。迁移 `0101_presentation_editor_v3` 保留内容、身份、revision 与更新时间，仅升级版本并补元素元数据；已有新能力的文稿拒绝旧格式降级覆盖。
`exchange/` 拥有有界 ZIP 文稿包、无写入预检、PPTX 解析、转换报告、素材准备与重映射；`routes/exchange.py` 只适配 HTTP。`pptx_objects.py`、`pptx_paths.py`、`pptx_playback.py` 与 `pptx_appearance.py` 分别映射原生表格图表、路径、媒体与样式；`visible_scene.py` 统一排除隐藏对象及关联连接。
Web `editor/` 拥有会话装配、共同命令、页面批量操作、查找替换、图层与面板；`objects/` 拥有原生元素内容编辑与 ECharts SVG；`objects/formula/` 拥有公式模板弹窗、异步预览和自然尺寸计算，通过现有 `formulaSvg.ts` 共用本地 MathJax 矢量生成；`exchange/` 拥有预检和静态图片／打印输出；`playback/` 拥有动画步骤、标注与同源观众同步。`web/mathFontData.ts` 在构建前将第三方字形轮廓发布为本地 JSON 数据资源，不改写构建产物或提高代码预算。`playback/useAudience.ts` 通过浏览器窗口与同源 BroadcastChannel 管理观众会话，弹窗被拦截时提供直接链接。

## 导演台

`backend/studio/apps/director_desk/` 拥有账号项目记录和用户动作库。
`director_desk_projects.document` 是编辑器写出的瘦 JSON：戏段、实体和资源引用。
模型、贴图和视频按内容 SHA-256 放在 `applications/director-desk/projects/{id}/files/`，
不进入 SQLite，也不给共享 `VisualAsset` 增加外键。
`director_desk_user_motions` 只保存动作元数据，模型包放在 `applications/director-desk/library/`。
迁移 `r0064_director_desk` 建立项目表，`r0065_director_desk_motions` 追加动作表。
`web/src/features/director-desk/` 拥有项目列表、`.director` 导入导出和三维编辑器，查询键在 `queryKeys.ts`。
`backend/studio/apps/director_desk/` 装配独立 ASGI 和显式 schema，持有自有账号目录和中断删除恢复。
编辑器会话在应用实例内持有，校验项目归属时只访问当前实例的会话工厂。
`deploy/director.compose.yaml` 装配隔离服务，`web/src/app/entries/director.tsx` 构建项目列表与三维预演深链接。
编辑器的 `model.ts` 是类型及公共入口，`model-constants.ts`、`model-creation.ts`、`model-validation.ts`
分别维护常量与复制、对象创建、项目校验；`assets/catalog/shape-types.ts` 保存资产形状契约，
`cinematography/camera-effects-types.ts` 保存镜头效果类型，`scenes/scene-document-types.ts` 保存戏段快照类型，
`spatial/scene-view.ts` 定义空间报告所需的只读场景接口。编辑器实例用 AbortSignal 管理监听器生命周期。
`editor/editor/scene-sampling.ts` 拥有单帧实体动画、接触、视觉、光照与镜头采样，`engine.ts` 保留资源生命周期与交互装配。
编辑器基础控件样式保存在 `style.css`；`ui/editor-workspace.css`、`ui/editor-timeline.css` 与
`ui/workspace-responsive.css` 分别拥有面板与视口、时间线、响应式与调整布局，入口按原级联顺序加载。
编辑器内存仍使用内嵌字节；保存前换成文件引用，打开时再还原。
外部 Agent 经 `fpl` 调用项目、文件和动作库；场景工具只在该工程的编辑器已打开时执行，不另建 MCP。

演示工坊的 `image_crop.py` / Web `imageCrop.ts` 分别拥有相同的原图区域到图片框的等比填充计算，
使用 `tests/fixtures/presentation_crop_cases.json` 共用测试向量。图片尺寸仅在读取素材后取得，
不进入文稿结构；浏览器缩略图和放映共用渲染器，PPTX 使用经 EXIF 校正后的素材尺寸。

图片与矢量素材的校验、预检与规范化归属公共 `backend/app/capabilities/asset_store/svg.py`，只支持受限自包含 SVG；
`/v1/files/svg/preview` 不持久化，上传继续走公共文件用例。文件列表默认排除 SVG，文件管理与演示工坊显式启用。
迁移 `0058_presentation_media` 只补齐确定性媒体外观缺省值，不改变文稿版本、revision 或更新时间。
演示工坊前端的 `usePresentationMedia` 统一插入和替换素材，`PresentationImages` 拥有文件搜索与分页，
`SvgImport` 拥有隔离图片预览；`PresentationShapePicker`、`shapeCatalog`、`iconCatalog` 管理分类和静态 Lucide 图标。
`SelectionMediaTools`、`MediaAppearance`、`MediaPreview` 管理媒体操作和精确外观。
`useImageCrop`、`ImageCropOverlay`、`cropGeometry` 管理可取消的裁剪草稿、旋转局部坐标及一次撤销提交。
`presentation-media.css` 维护媒体工具、选择器与裁剪覆盖层；覆盖层不进入缩略图、放映或导出。

视频创作工坊的图片预览裁剪由 `CanvasImageCrop` / `ImageCropSurface` 拥有临时选区、比例选择、键盘与触摸操作；
`imageCropGeometry.ts` 使用原图像素坐标，`imageCropExport.ts` 从同一已解码静态帧导出保留透明度的 PNG。
保存复用公共文件上传与画布 CAS，`derivedImageNode.ts` 负责裁剪和视频截帧派生节点的稳定身份及避让位置。
裁剪保存失败保留已上传素材并重试同一节点；冲突返回现有画布版本选择界面。裁剪不创建生成任务或修改原素材。
样式归属 `styles/image-crop.css`，浏览器验收由 `canvas-image-crop.spec.ts` 覆盖。

视觉画布的 `canvasClipboard.ts` 拥有选区深拷贝、外部连线引用清理、节点与连线身份重映射及粘贴边界检查；
`useCanvasClipboard.ts` 管理当前项目内的临时剪贴板、连续粘贴偏移与反馈，所有复制入口共享同一逻辑。
`CanvasSelectionActions.tsx` 展示多选复制及符合条件的宫格合成操作，合成状态仍由 `useImageGridComposition.tsx` 拥有。
副本保留素材和生成草稿，解除原任务及批次关联；整组粘贴通过画布快照提交一次 CAS 并形成一次撤销记录。
剪贴板不持久化，离开画布后失效；浏览器旅程由 `canvas-clipboard.spec.ts` 覆盖。

## Python SDK 与自动化

- `sdk/python/`：可独立构建安装的 `future-props-lab-sdk`；`src/future_props_lab/generated/` 只保存生成模型和具名资源方法，其他模块拥有 HTTPX 通信、流、鉴权、实时语音和本地文档构建器。
- `sdk/python/operations.json`：受版本控制的 HTTP 操作到稳定 Python 方法名映射；`coverage.json` 记录契约与文档证据，不能替代业务闭环验收。
- `scripts/test_with_proof.mjs` 将 `web/e2e/test-with-proof.catalog.yaml` 和专用 Playwright 配置接入功能验收工作台。隔离环境和验收产物位于 `.local/test-with-proof/`。
- `scripts/generate_sdk.py`、`scripts/generate_sdk_docs.py`：从 OpenAPI 与方法映射生成 SDK 和公开模块参考；纳入 `contracts:generate` 与 `contracts:check`。仅浏览器 Session 的知识社区操作不加入 SDK 方法映射，相关 HTTP 数据类型仍由 OpenAPI 生成。
- `backend/app/llm/inference/`：独立模型能力查询、输入素材、文本调用、任务与结果管理；`llm/routes/model_inference.py` 只处理协议。
- 工坊各自的 `operations.py` 拥有细粒度编辑校验与一次事务；`runtime/operation_receipts.py` 仅提供持久化回执原语，`entity_edits.py` 仅提供纯列表编辑。
- `backend/app/llm/models/model_inference.py` 与 `models/project_operations.py` 对应追加迁移 `0059_project_operations`、`0060_model_inference`。
- `web/src/features/models/inference/`：调用日志页中的独立任务查询、下载、转存与结果落盘重试入口；缓存键归属 models/queryKeys.ts。
- `web/src/docs/articles/sdk/`：公开 SDK 教程及生成方法参考；开发文档仍经已授权接口加载。
- `backend/studio/apps/thought_workshop/markdown_conversion.py` 与 `content_exports.py`：受控 Markdown 转换、静态 HTML 和含素材导出；`schemas/conversion.py` 描述正式契约。
- `backend/studio/apps/audio_annotation/exports.py`：项目 JSON、SRT、已保存片段裁切与识别用例。
- `backend/app/capabilities/asset_store/video_frames.py`：账号文件的逐帧提取；确定性音频裁切与视频取帧实现归属 `media_rendering/audio_clip.py`、`video_frames.py`；HTTP 适配在 `capabilities/asset_store/routes/video_frames.py`。
- `web/src/docs/DocsExamples.tsx`、`DocsReadingProgress.tsx`：受控代码切换与阅读进度；目标阅读入口使用 `rendering/` 的 CardGroup；模块参考按业务模块分包，保留完整搜索内容。
- `sdk/python/src/future_props_lab/workshop_examples.py` 与 `sdk/python/workflows.json`：六个工坊可执行流程及业务证据，公开文档从样例源码生成；验收边界见 `docs/architecture/sdk-automation-coverage.md`。
- `sdk/python/src/future_props_lab/canvas_example.py`：独立的笔记信息图 SDK 示例，通过正式 API 创建与导出可编辑画板；不参与既有六工坊文档生成，契约回归由 `tests/test_thought_canvas.py` 覆盖。
- `skills/future-props-lab-automation/`：官方自动化 Agent Skill 包（根 `SKILL.md` 名 `future-props-lab-automation`）。叶子 skill 目录名必须等于 frontmatter `name`，可单独或组合安装；每个叶子内联「前置」与最小 `fpl` 示例。校验：`python3 skills/future-props-lab-automation/scripts/validate_skills.py`。只指导通过 `fpl`/SDK 操作产品，不修改本仓库源码；见该处 `README.md`。
- `.agents/skills/watch/`：仓库级第三方视频分析 Agent Skill，包含中文通用指南、基于固定上游的通用脚本、许可证与固定提交来源记录；仅供 Codex 在本仓库发现，不参与 Future Props Lab 产品构建。应用内 Skills 通过正式 ZIP 导入 API 单独管理。
- `skills/future-props-lab-automation/skills/thought-workshop/research-to-document/`：产品使用与技术／论文调研 Skill；普通父笔记直接承载报告，子文档用已有多维表格组织资料、比较与验证，正文引用精简嵌入视图。`references/` 拥有记录与存档契约，`assets/` 提供两类成文模板、恢复快照与原生 TableSpec，`scripts/check_project.py` 只读校验引用与状态。正式存档复用思绪工坊 CLI/SDK，不增加专用调研页面、应用内 AI 写作入口或后台调研服务；原型、截图与打包验收产物位于 `.local/research-workbench-preview/`。
- `skills/future-props-lab-automation/skills/visual-workshop/visual-character-replacement/`：人物与可选场景替换制作流程；`references/` 拥有镜头规划、review、记录与 App 适配说明，`assets/templates/` 拥有同源的 JSON、六类文本监督模板和 HTML 对照页，`scripts/` 拥有标准库本地记录校验、版本绑定、反馈合并及渲染。工具不调用 App 或模型，正式同步仍经授权 API；ZIP、演示媒体与验收产物只在 `.local/` 下生成。
- `backend/app/capabilities/asset_store/image_crop.py` 与 `capabilities/asset_store/schemas/image_crop.py`：公共文件的像素裁剪、边界与透明度规则，返回 PNG 后由调用者显式转存；HTTP 适配在 `capabilities/asset_store/routes/image_crop.py`。

### 内置角色展示

首页直接加载 `web/public/brand/home/` 的红莉栖待机动画与透明回退图，不读取账号项目。Amadeus 使用 `shared/live2d/` 的纯姿态、网格与渲染能力，内置模型位于 `web/public/brand/amadeus/`；后端 `media_rendering/live2d/` 只保留离线渲染及内置模型校验，`scripts/generate_avatar_contract.py` 从纯模型生成独立的头像资产类型。角色编辑工坊和独立桌宠运行已退役，`0118_retire_character_workshops` 移除专属表，历史迁移保留。

## 视觉项目看板与输出历史

`visual_workshop/schemas/prompts.py` 定义三类媒体草稿共用的提示词版本契约，`prompt_versions.py` 在画布用例边界保留旧客户端更新时的版本集合。`generation/usePromptVersions.ts` 持有独立编辑版本的同步快照，`PromptVersionControls.tsx` 提供画布与看板共用的版本操作；版本随节点 JSON 和画布 CAS 保存，生成仅消费当前文字。参考图片排序同步更新全部版本，输出历史保持独立生命周期。

`board/MaterialTree.tsx` 为已有媒体输出提供项目素材拖拽数据；`generation/useProjectReferenceDrop.ts` 拥有生成参考框的拖入解析、项目文件与类型校验、去重及数量限制，放下后由 `ReferenceDropNotice.tsx` 提示成功或失败原因，参考框通过原草稿回调保存当前文件。全能参考栏统一按媒体类型路由拖入，不改变节点连线或来源选择。

`generation/generationActivityModel.ts` 将节点关联的任务／图片批次快照归一为运行状态，`GenerationActivity.tsx` 与 `generation-activity.css` 拥有紧凑状态栏、已用时和共用转圈图标。看板右侧输出历史、节点标题、素材树、状态分组与生成按钮共用运行状态；未知进度保持不定值，现有输出版本与当前任务分开显示，不用参考素材模拟中间帧。

`backend/studio/apps/visual_workshop/outputs/` 拥有节点输出 ORM、历史分页、最终版本 CAS、输入解析与提交快照、上传事务及快照重映射；包入口提供 `register_imported_output`，供视频剪辑分段交接在取得画布 CAS 写锁后、同一事务内登记素材版本；`routes/outputs.py` 只负责协议适配。`canvas.py` 保留节点身份、分类与连线整体 CAS，兼容旧素材写入并统一登记版本。`generation_runner.py` 在落盘后短事务中幂等归档输出。`web/src/features/visual-workshop/board/` 拥有项目素材树、创作工作台、状态分组、历史预览与输入选择，并按素材整理、管理菜单、节点元信息与状态呈现拆分；shell、工作台与状态卡样式按职责独立维护。生成组件通过显式 `layout` 参数适配工作台，保留画布布局；画布控制器统一持有草稿、选择与视口，项目页保留两种视图切换时的历史预览。

视觉画布 `canvasPlacement.ts` 拥有卡片与节点组的有界避让，`canvasLayout.ts` 拥有稳定的流程与网格布局，`canvasVisibleArea.ts` 计算排除固定控件后的可见区域；`useCanvasSpatialActions.ts` 将纯位置结果接入视口、整体保存与单次撤销。各新增入口共用该能力，临时编辑面板不影响持久布局。后端 `visual_workshop/node_placement.py` 只处理后台自动节点，显式 API 坐标沿用原契约；`tests/fixtures/visual_node_placement.json` 同时约束前后端尺寸与默认避让结果。

`backend/app/llm/providers/volcengine_image.py` 拥有方舟 Seedream 4.5 原生图片数组协议。共享 `generation_runtime/driver.py` 接收同步图片结果并持久化下载地址，提交中断禁止重提。迁移 `r0086_visual_node_outputs` 回填明确关联的历史，`r0087_volcengine_images` 扩展供应商枚举，保留旧模型凭证与任务数据。

## ZEALMAN 视频模型测试与工坊生成

`llm/providers/zealman_workflows.py` 保存 U17、U06 的固定 `input_values` 键契约、参考数量和参数范围；
图片、视频与音频按各自输入顺序映射到从零开始的 `ref_image_n`、`ref_video_n`、`ref_audio_n`，
提示词使用 `prompt`。不提交节点数字键或整张工作流，避免 API 模式将已上传但未显式传参的参考替换为空白占位。
`zealman_video.py` 拥有同源素材上传、提交、结果轮询及任务账本恢复。测试台通过能力元数据展示
参数，不读取原始 ComfyUI 事件。`llm/schemas/workflow_video.py` 拥有共用工作流参数与能力契约。
视觉创作工坊通过自己的模型选项、项目素材校验和 runner 接入两个工作流；沿用画布 CAS 与输出归档，
模型菜单共用 CustomSelect 的顶层 popover。独立推理目录维持原支持范围。
迁移 `0091_zealman_video` 扩展连接和模型测试任务的协议约束，保留已有数据和外键。
迁移 `0092_visual_zealman_video` 扩展工坊任务协议约束，同样保留原记录、索引与外键。

视觉节点的 `approved` 人工确认标记由画布节点 JSON 持久化，`NodeApproval.tsx` 提供工作台、状态卡与画布共用入口，素材菜单复用相同画布更新契约。输出登记／切换／删除在 `outputs/history.py` 清除确认；正文变更由画布写入校验清除。迁移 `r0094_visual_node_approval` 为旧节点补默认值，不改已有布局、版本或 revision。

## AutoDL zealman 工作流

`backend/app/llm/providers/autodl_workflows.py` 固定登记 AutoDL 页面署名 zealman 的 12 个工作流，
拥有模式、提示词、素材格式及数量、时长语义、输出尺寸组合、种子范围和请求字段映射。
`autodl_video.py` 拥有原始 Authorization Token、提交与结果轮询协议。三个入口共用
`VideoCapabilitiesOut` 与准入归一化，并复用 GenerationTaskDriver；图片、音频与动作视频直接编码
为 Base64，业务记录保留素材 ID 和参数，不保存编码内容。迁移 `0113_autodl_video` 扩展连接、
测试任务及工坊任务类型约束，保留历史和外键。

视觉工坊 `outputs/references.py` 在显式启用双帧槽位时将画布图片连线解析为首帧、尾帧，并保留
输入快照与 CAS；视频草稿使用 `VisualVideoPromptVersion` 保存最长 20000 字符的版本。
Web `models/generation/videoCapabilities.ts` 共用能力选择、参数组装与校验，`VideoSeedControl.tsx`
拥有可选随机种子输入；工坊 `generation/useVideoDefaults.ts` 负责首次选择与不兼容草稿的默认参数恢复；`catalog/autodlPresets.ts` 只保存模型预设的展示名称和 ID。

## Seedance 官方视频接入

`llm/providers/volcengine_video.py` 拥有方舟视频创建／查询协议及状态归一化；
`seedance_parameters.py` 按版本提供公共视频能力与参数校验，`seedance_references.py`
在任务 admission 前校验本地参考文件。模型测试、视觉工坊与独立推理只持有各自的素材和任务，
复用 `GenerationTaskDriver`，不互相导入实现。公共 `VideoCapabilitiesOut` 同步前端参数选择、
画布草稿和 SDK 契约；参考视频复用已配置的临时素材上传服务。

## 可选本地语音模型

`llm/local_models/` 拥有固定下载清单、独立 Python 环境安装、恢复与 MLX 子进程生命周期；
导入和应用启动均不访问下载源。`worker.py` 是仅依赖独立环境的管道程序，不导入应用或数据库。
`llm/providers/local_qwen.py` 归一化参考录音校验和合成参数；`llm/inference/` 复用任务、素材和日志。
`console/governance/local_models.py` 校验平台管理员浏览器身份，`llm/routes/local_models.py` 仅适配 HTTP。
`web/src/features/models/` 拥有安装管理与语音测试页面，调用共用推理 API。
`generation/SpeechSynthesisTestPanel.tsx` 装配配音表单和按模型筛选的生成记录，
`useSpeechDraft.ts` 拥有参考录音替换、输入校验、单次提交与身份切换后的异步结果隔离；
`SpeechSynthesisResult.tsx` 通过鉴权 Blob URL 播放、定位、下载与保存结果，
`speechSynthesisPresentation.ts` 统一语言、任务状态和音频时间文案，`speech-synthesis.css` 限定语音工作区布局。

`0103_local_models` 新增部署级安装元数据和操作回执，不保存账号数据。
模型权重与环境属于可再下载缓存，桌面保存于数据根 `local-models/`，源码部署保存于运行目录下
`local-models/`；数据库备份恢复后可主动重新安装。语音输入与输出保存在对应空间的
`model-inference/inputs/`、`model-inference/outputs/`，沿用账号备份和访问边界。

## 视觉工坊节点验收

`backend/studio/apps/visual_workshop/acceptance/` 拥有只读动作迁移定义、节点方案 CAS 绑定、自动生成依据、不可变输出验收记录、人工结论、证据、返修和快照兼容。`execution/` 负责无凭据任务包、专用媒体 MCP 和 Agent 报告转换。`runner.py` 复用短事务及 RunnerSupervisor，模型 API 与 Agent 专属结果分别保存。生成快照与上传版本的节点设置明确区分，验收不参与生成、上传、画布保存及最终输出采用的门禁。

`backend/app/capabilities/agents/cli/` 拥有 Codex、Claude Code、OpenCode、DeepSeek Harness 和 Pi 的非交互执行。`transport.py` 维护受控环境与进程生命周期，`conversation.py` 维护原有 Codex/Claude 对话协议，`native.py` 维护 OpenCode JSON 事件、Harness ACP 与 Pi RPC，`isolation.py` 只继承模型连接与认证配置并生成临时执行配置；旁置 `.mjs` 资源提供 Pi 的唯一任务工具桥与 Harness 的不可放宽工具 guard，桌面构建显式打包。不包含验收业务。`console/governance/visual_acceptance_access.py` 复核提交者的有效权限；桌面 `acceptance_tools_entry.py` 独立打包媒体工具，不传递 FPL 凭据。

`web/src/features/visual-workshop/acceptance/` 的项目入口只提供只读模板与节点汇总；画布和看板共用 `NodeAcceptancePanel`，节点负责方案选择、启动、报告、人工确认及返修复验。验收状态、生成状态和最终输出分别展示。查询键由 `queryKeys.ts` 维护；[配置与执行边界](../operations/node-acceptance.md) 说明固定连接与历史 API 兼容。

- `console/governance/code_agents.py` 解析有效账号自有任务使用的共享 CLI 连接。`code_agent_connections.py` 负责本机启用，`deployment_config.py` 与云控设置共用 TOML 配置锁。`console/routes/code_agents.py` 只做协议适配。`capabilities/agents/cli/` 统一 CLI 发现、模型连接白名单、官方对话与固定任务传输；`scripts/website/codex_login.py` 建立 app-server 的专用登录，云控项目路径由授权文件工具消费；`web/src/features/code-agents/` 拥有管理页和查询键。独立 SDK 的 `mcp.py` 拥有外部 stdio MCP 与内部短期 Socket 中继，不导入后端。

### 视频透明检查与格式信息

`capabilities/media_rendering/media_info.py` 拥有有界只读媒体探测，`animated_image.py` 拥有 GIF 的黑底 MP4 与透明 WebM 转换。`capabilities/asset_store/media_info.py` 及对应 routes/schemas 拥有账号校验与格式接口；`visual_workshop/outputs/` 拥有检查素材关联、原子上传与快照。Web `visual-workshop/board/VideoOutputPreview.tsx` 拥有视频格式、纯色衬底及全屏检查，`output-preview.css` 保存共用输出画面样式；预览状态不进入画布。迁移 `0115_visual_output_inspection` 仅追加检查素材引用。

### 角色工坊退役验收

`web/e2e/retired-character-workshops.spec.ts` 覆盖首页内置动画、明暗主题、390/768/1600 宽度、减少动态效果及 Agent 工作台徽章。该首页展示不启动任何独立角色窗口，也不读取私人角色项目。

### Models 拆分准备

`llm/catalog/task_usage.py` 定义目录修改所需的显式任务占用接口。`legacy_usage.py` 仅用于迁移期单体，读取其原有任务表并显式限定账号；目录本体不再查询工坊内部表。独立 Models 必须注入自有执行记录的实现，缺少实现时拒绝相关写操作。提供方先验证归属再检查占用，其他账号 ID 仍返回不存在。

## 独立管理服务

`backend/studio/apps/management/` 拥有管理装配、公开协议、自有运维任务/状态 ORM、显式迁移和 worker 接收协议；不导入其他服务 ORM。Identity 拥有管理会话及用途迁移；Models 拥有模板、额度与演示治理，浏览器经独立管理网关访问这些接口。`backend/studio/assembly/host/management*.py` 拥有 Mac 限定 Compose 控制、双 SSH 生命周期和持久执行回执。`scripts/management/` 拥有一键启动及独立 LaunchAgent。`web/src/app/entries/management.tsx` 拥有独立入口与认证装配，`features/accounts/management/` 拥有运行与访问页面；公开类型来自单独管理 OpenAPI。`deploy/management.compose.yaml` 是独立管理部署叠加清单，`deploy/images/management/` 保存最小依赖锁和镜像定义。验证入口为 `tests/test_management_service.py`、`tests/test_management_host.py` 与 `web/playwright.management.config.ts`。详见[管理服务参考](../reference/management-service.md)。


### 应用服务状态

`studio/contracts/gateway/service_status.py` 定义注册服务 ID、生命周期和只读状态契约。`studio/host/service_observation.py` 只读取所选 Compose 项目的配置服务清单与进程状态，拒绝把 Docker 故障误报为停止；不读取业务数据库、环境内容或日志。观测嵌入 Management 已有的自有快照，不共享数据库。`studio/apps/gateway/service_status.py` 从固定服务地址做有界就绪探测，合并新鲜主机证据并按依赖图计算功能受限；错误或过期观测无法确认停止。`deployment.status.read` 只允许原始 Gateway 状态读请求委托到 Management 的状态读接口，不获得运维命令权限。

`features/applications/ApplicationCenterRoute.tsx` 拥有按账号缓存的自动检查；纯页面与 `ApplicationServiceStatus.tsx` 拥有状态和展开说明。`serviceStatus.ts` 使用生成契约，`queryKeys.ts` 唯一维护查询键。静态目录显式绑定 `serviceId`，不能凭页面名称猜测服务。连接失败时只把缓存作为上次结果展示；单体兼容入口明确声明共用进程。
