# API 参考

交互式 OpenAPI 位于后端 `/docs`。所有业务接口注册在 `/v1`；配置 `FPL_STUDIO_TOKEN` 后携带 `X-Studio-Token`。

## 模型目录

- `GET /v1/model-categories`：返回模型类别字典及对应的 `type/sub_type`。
- `GET/POST /v1/model-providers`
- `PATCH/DELETE /v1/model-providers/{provider_id}`
- `POST /v1/model-providers/{provider_id}/enabled`
- `POST /v1/model-providers/{provider_id}/models`
- `PATCH/DELETE /v1/model-entries/{model_id}`
- `POST /v1/model-entries/{model_id}/test`

目录写入必须携带最后读取的 `expected_catalog_revision`。冲突返回 `409 revision_conflict` 和服务器当前快照。
模型的 `capabilities` 描述实际输入和调用能力，`categories` 描述模型用途并允许多选；两者都只通过
模型创建/更新 API 写入。类别字典参考 SiliconFlow 的 `type/sub_type` 语义，当前包含文本生成、
其他通用模型、语音合成、语音识别、音乐生成、视频生成、图片生成和端到端语音模型。

测试调用使用固定提示词、16 个最大输出 Token 和 30 秒超时；无论上游成功、失败或超时均记录日志，API Key 不进入请求或日志 payload。

## 调用日志

- `GET /v1/llm-call-logs`：支持搜索、调用源、供应商、模型、状态、日期和分页。
- `GET /v1/llm-call-logs/stats`
- `GET/DELETE /v1/llm-call-logs/{log_id}`
- `POST /v1/llm-call-logs/batch-delete`

调用源 `model_diagnostic` 表示模型服务行内的固定 `OK` 快速诊断，`model_playground` 表示模型测试
工作台，`visual_workshop_assistant` 表示视觉工坊 Agent。详情按请求上下文、模型回复、Token 与
耗时分区展示，并支持可读/JSON、Markdown/原文切换。新产生的流式文本日志记录首 Token 耗时、
结束原因和模型轮次；旧日志没有对应观测值时返回原 payload 并显示为空。

## 模型测试

- `GET/POST /v1/model-test/conversations`
- `GET/PATCH/DELETE /v1/model-test/conversations/{conversation_id}`
- `POST /v1/model-test/conversations/{conversation_id}/attachments`：multipart 批量上传待发送图片。
- `DELETE /v1/model-test/conversations/{conversation_id}/attachments/{attachment_id}`：删除未发送图片。
- `GET /v1/model-test/conversations/{conversation_id}/attachments/{attachment_id}/content`：鉴权预览图片。
- `POST /v1/model-test/conversations/{conversation_id}/messages/stream`
- `POST /v1/model-test/conversations/{conversation_id}/regenerate/stream`
- `GET /v1/model-test/generation-options`：返回所有已启用图片/视频测试模型及图片尺寸。
- `GET/POST /v1/model-test/generation-tasks`
- `GET/DELETE /v1/model-test/generation-tasks/{task_id}`
- `GET /v1/model-test/generation-tasks/{task_id}/content`：鉴权预览独立测试结果。
- `POST /v1/model-test/generation-tasks/{task_id}/retry-materialization`
- `POST /v1/model-test/generation-assets`：批量上传模型测试私有的不可修改草稿素材。
- `DELETE /v1/model-test/generation-assets/{asset_id}`：删除尚未被任务认领的草稿。
- `POST /v1/model-test/generation-assets/cleanup`：清理超过 24 小时的草稿和遗留文件。
- `GET /v1/model-test/generation-assets/backfill-status`：检查仍引用旧公共文件的历史任务。
- `POST /v1/model-test/generation-assets/backfill`：幂等复制历史素材并通过任务 CAS 完成认领。

修改、删除、发送和重新生成使用会话 `expected_revision` 做 CAS 保护。发送请求可携带最多 5 个
`attachment_ids`，文本和图片至少提供一项。图片仅支持 JPEG、PNG、WebP 与静态 GIF，单张
最多 8 MiB、宽高最多 8000 像素；只有同时具有 `chat`、`vision` 能力的模型可处理图片。
图片随消息私有保存，成功轮次的历史图片会继续进入后续请求，重新生成复用原用户消息图片。
调用日志记录脱敏文本上下文、最终文本回复、会话 ID、首 Token、结束原因和轮次；图片仅记录 MIME
与大小，不记录图片内容或磁盘路径。流式接口返回 SSE v2 envelope，事件为 `start / delta / done /
error`；成功、失败、超时或取消都会保存消息状态并写入调用日志。

模型测试页按供应商协议自适应：OpenAI/Anthropic 模型进入多轮对话，SenseAudio 图片/视频模型进入
独立异步生成测试。图片测试支持提示词、尺寸和种子；视频测试支持提示词、时长、分辨率、比例、
水印、生成音频，以及上传最多 9 张图片、3 个音频和 3 个视频到模型测试私有草稿区。创建任务会在
同一事务认领这些草稿；新任务不能引用公共 `visual_assets`。历史任务由显式回填 API 迁移，原公共
文件保持不动。任务结果下载到 `model-test/generated/`，不创建视觉工坊项目或素材。任务与模型
目录都通过 `/v1` API 管理，活动任务不可删除或随模型一起停用；终态删除使用 revision/CAS。

## 工具导航

- `GET /v1/tool-navigation/state`：读取工具收藏与最近使用状态。
- `PATCH /v1/tool-navigation/tools/{tool_id}`：通过 `is_favorite` 幂等更新收藏状态。
- `POST /v1/tool-navigation/tools/{tool_id}/use`：原子递增使用次数并更新最近使用时间。

工具目录本身由 Web 注册表维护，后端只保存由小写字母、数字和连字符组成的稳定工具 ID。
状态属于当前单机 Studio 全局数据，不建立用户或多租户归属。

## 视觉创作工坊

- `GET/POST /v1/visual-workshop/projects`：按最近更新时间读取项目或新建项目。
- `GET/PATCH/DELETE /v1/visual-workshop/projects/{project_id}`：读取、修改或删除单个项目。
- `GET/PUT /v1/visual-workshop/projects/{project_id}/canvas`：读取或以 CAS 保存完整节点画布。
- `POST /v1/visual-workshop/projects/{project_id}/asset-references`：把文件管理中的文件引用到项目。
- `PATCH/DELETE /v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}`：整理或移除项目引用。
- `GET/POST /v1/visual-workshop/projects/{project_id}/conversations`：读取或新建项目对话。
- `GET /v1/visual-workshop/projects/{project_id}/conversations/models`：返回当前已启用且支持对话的模型选项。
- `GET/PATCH/DELETE /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}`：读取、改名或删除对话。
- `POST /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}/messages/stream`：发送消息并接收 SSE 流。
- `POST /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}/runs/{run_id}/approvals/{approval_id}`：确认或拒绝当前内存中的 Agent 操作组。

项目类型为 `image / video / canvas`，状态为 `draft / completed`，标题长度为 1–120 字。
修改和删除必须携带项目的 `expected_revision`；冲突返回 `409 revision_conflict` 以及服务器
当前项目快照。Web 新建流程固定创建名为“未命名项目”的 canvas 项目并直接进入项目画布；
旧的 image/video 项目仍可按画布打开。画布文档保存文本、图片、视频和音频节点的标题、内容、
素材/生成任务引用与世界坐标，并使用独立于项目元数据的 `revision`。图片和视频节点还可携带
`generation_draft`，分别保存节点级提示词、模型、生成参数与参考素材选择；草稿允许尚未满足生成
条件，但仍校验字段范围、素材数量、媒体类型和项目归属。`PUT` 必须携带
`expected_revision`；冲突返回服务器画布快照，Web 不会静默覆盖。图片/视频节点创建生成任务后
保存任务 ID，任务完成时把结果素材回填到原节点，同时保留原生成草稿。Web 对草稿文字使用画布
自动保存，对素材和离散参数立即保存，并在创建生成任务前等待画布保存完成。上传文件本身立即进入
项目素材库，取消草稿选择不会删除文件。视口缩放和平移仍属于浏览器本地偏好。

项目对话标题和模型配置使用独立会话 revision 做 CAS。`PATCH` 可通过 `model_id`、
`image_model_id`、`video_model_id` 分别固定 Agent 的对话、图像生成和视频生成模型，传 `null`
恢复该类任务的自动选择；Web 在三类 Tab 中按供应商浏览并自动保存，生成期间禁止切换。固定的
图像或视频模型会覆盖 Agent 工具提案中的模型 ID；如果固定模型或供应商不可用，本次生成会明确
失败并提示重新配置，不回退到其他模型。该配置只影响当前助手对话，不改变手动图片/视频生成器的
模型选择。发送体除会话 `expected_revision` 外还必须携带已完成本地保存后的 `canvas_revision`。
发送准备与流式结算分别使用短事务，供应商网络等待和审批等待不占用写事务。

新客户端通过 `content_parts` 发送结构化正文，元素为 `{type: "text", text}` 或
`{type: "asset", asset_id}`。素材引用按正文位置展开给模型，同一素材可重复出现，但只按首次出现
顺序建立一个消息附件关系并占用一个名额。服务端同时把素材投影为 `@文件名` 保存到 `content`，供
旧客户端、标题和诊断使用；精确位置以 `content_parts` 为准。旧客户端仍可发送 `content + asset_ids`，
但不得与 `content_parts` 混用。历史消息没有结构化正文时返回空数组，由客户端回退到旧正文和附件区。

视觉 Agent 每个模型轮次重新编译项目、最新画布、素材摘要和相关生成任务上下文；单文本节点最多
4,000 字，总上下文最多 32,000 字并保留截断说明。支持工具的模型可自动使用 `read_canvas`、
`list_project_assets`、`list_generation_options`、`inspect_generation_task`；`apply_canvas_changes` 与
`start_generation_on_canvas` 始终要求审批。审批只接受当前进程中属于指定项目和对话的待处理项，
默认五分钟过期；确认不会把旧提案重基到新 revision，发生冲突时工具不写入并让 Agent 重新规划。
多个节点修改由单个 `operations[]` 调用和一次画布 CAS 原子执行，生成任务与占位节点在同一短事务
中创建。只支持 `chat` 的手选模型仍可对话，但进入只读建议模式；自动选择优先 `chat + tools`，
附图时优先 `chat + vision + tools`。

项目对话每条消息最多 5 个不同附件，重复内联引用不重复计数。JPEG、PNG、WebP、GIF 与 AVIF 图片作为视觉输入且单张最多 8 MiB，
其中 AVIF 会在进入供应商适配器前转换为 PNG；
TXT、Markdown 和 PDF 正文以不可信附件内容加入模型文本上下文，单文件最多 50,000 字符、
单条消息合计最多 100,000 字符，PDF 最多读取前 50 页。音视频仅向模型提供素材 ID、名称、类型与
大小等元数据，不执行转录或二进制输入。附件仍遵循项目文件上传的类型与大小限制；
被消息引用的素材返回 `409 asset_in_use`，必须先删除对应对话。SSE `start` 可携带
`attachment_warnings` 提示加密、无法解析或被截断的文档。SSE v2 事件为 `start / delta / step /
approval_required / approval_resolved / canvas_updated / generation_task_created / done / error`。消息历史
保存已脱敏的步骤展示摘要与结果，不保存供应商原始事件或未脱敏工具参数；重启时遗留 pending 消息
和运行中步骤结算为取消。调用日志来源为 `visual_workshop_assistant`，记录脱敏文本消息轨迹、最终
文本回复、run、轮数、工具名、脱敏输入与结果、审批结果、首 Token、耗时、画布 revision、生成任务
ID、消息数量、画布摘要和素材 ID；不保存图片 Base64、临时链接、磁盘路径、密钥或供应商原始事件。

## Galgame 工坊

- `GET/POST /v1/galgame-workshop/projects`：按最近更新时间读取工程或新建空白工程。
- `GET/PATCH/DELETE /v1/galgame-workshop/projects/{project_id}`：读取、修改或删除单个工程。
- `GET/PUT /v1/galgame-workshop/projects/{project_id}/story`：读取或整份 CAS 保存 V1 故事文档。
- `GET /v1/galgame-workshop/projects/{project_id}/story/report`：检查 Fragment 可达性、结局和循环。
- `GET/POST /v1/galgame-workshop/projects/{project_id}/assets`：搜索或上传工程私有的故事图片与声音。
- `DELETE /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}`：按素材 revision 删除未被故事使用的工程素材；引用冲突返回可定位的角色、Fragment 与 Block 信息。

工程状态为 `draft / completed`，标题长度为 1–120 字。修改和删除必须携带工程的
`expected_revision`；冲突返回 `409 revision_conflict` 以及服务器当前工程快照。新建工程会同时
写入 `schemaVersion: "1.0"` 故事文档，预置 `chapter-1` 章节和入口为 `main` 的空 Fragment。
故事包含 `synopsis`、角色、场景、预留变量及 `chapters → fragments → blocks`；首批 Block 支持场景、
旁白、对白、分支和章节结局。角色可选 `expressions[]` 和 `defaultExpressionId`，表情通过故事
`assets[]` 中的 `characterPortrait` 记录引用文件，对白可用 `expressionId` 覆盖角色默认表情。场景可选
`backgrounds[]` 和 `defaultBackgroundId`，背景通过 `sceneBackground` 记录引用文件；Scene Block 可用
`backgroundId` 固定背景状态，未指定时跟随场景默认；`clearCharacters` 控制切换场景时是否清空舞台角色。
`showCharacter` Block 以 `characterId` 为舞台唯一实例进行登场或调整，保存表情、百分比位置、比例、亮度、
透明度、水平翻转、层级与基础过渡；`removeCharacter` 可让指定角色或全部角色退场。故事保存使用独立
`expected_revision`，严格拒绝重复 ID、悬空引用、跨角色表情、越界角色变换、跨场景背景和少于两个选项的分支；冲突快照包含服务器当前完整故事，
旧版 V1 缺少立绘或背景字段时在读取中补默认空值，首次保存后自然写入扩展格式。

对白的可选 `portrait` 保存 `stage / solo / hidden` 立绘模式、对白后是否保留、可选角色变换与过渡。
缺少 `portrait` 的旧对白继续使用单人临时立绘；新建对白默认加入多人舞台并保留角色。`stage` 模式未指定
变换时继承角色当前舞台状态，不在场时使用底部居中的默认变换。

`presentation.dialogueBox` 保存工坊内置试玩的全局对话框外观，包括预设、底色、正文与角色名颜色、
透明度、圆角和字号。可选 `assetId` 必须引用 `assets[]` 中 role 为 `dialogueBox` 的静态图片；上传图片
与角色立绘、场景背景复用同一套工程私有素材和全局文件引用生命周期。旧 V1 故事缺少
`presentation` 时读取为默认暗色对话框，首次修改后随 Story CAS 整体保存。
`presentation.stage` 保存多人舞台的说话者自动聚焦开关、非说话者亮度倍率、聚焦过渡时长与
`lipSyncEnabled`。角色基础亮度始终保存在具体演出 Block，自动聚焦只在试玩渲染时叠加，不改写故事
数据。口型开启后，运行时以无对白区间采样的底噪为基准，在约 12fps 下把当前说话者同一姿态的
`f000 / f001 / f002` 闭口、半口和张口差分映射为三档音量口型；旁白、暂停、无对白和非说话者保持
闭口，缺少配套差分的素材静默回退到作者指定的表情。

`presentation.ui.components` 保存项目级自定义 Gal 界面组件。组件不预设为日期 HUD、快捷栏或其他
固定用途；每项自行定义 `name`、`assetId`、百分比坐标 `x` / `y`、百分比宽度 `width`、显示时机
`visibility` 与叠放层级 `layer`。组件图片统一使用 `uiComponent` 素材角色，编辑器支持任意增删、上传、
从文件库选择、替换和移除。旧版固定界面槽位在读取时会迁移为普通自定义组件。

故事声音与图片共用 `assets[]`，音频素材使用 `type: audio` 和
`voiceSample / voiceLine / backgroundMusic / ambientSound / soundEffect / timelineTrack` 角色。角色可通过
`voiceProfile` 保存声线名称、语言、描述和试听样本；对白通过 `voiceAssetId` 与 `voiceVolume`
绑定逐句配音。`audio` Block 显式控制 `bgm / ambient / sfx` 通道的播放、停止、音量、循环和
淡入淡出；BGM 与环境音不会从场景隐式继承。Fragment 可选 `timeline: { assetId, durationMs }`，
并通过对白或旁白成对的 `startMs / endMs` 绑定一条持续播放的剧情时间轴。保存时会校验时间非负、
起止有序、互不重叠、不超过总长，并要求 `assetId` 指向 `timelineTrack`；普通 Fragment 与旧故事
仍保持原有手动播放语义。编辑器可在剧本流和可视化时间轴之间切换，以角色颜色显示对白片段和
舞台事件锚点，支持共享分界拖动、首尾边界、片段平移、100ms 吸附、连锁移动和 `mm:ss.mmm` 精确
输入。开场、内部与结尾的无对白区间由相邻对白边界和时间轴总长推导，不创建 Gap Block；选中后可直接
编辑其有效边界。时间轴还提供 300ms 预听、所选对白循环与播放头设为起止点。所有合法修改仍通过整份
Story CAS 自动保存。时间轴播放头、缩放、循环与连锁移动偏好只存在于浏览器，不进入故事文档；试听或
试玩遇到无对白区间时仍连续播放完整音轨（包括其中的音乐和环境声），同时保留舞台状态、关闭口型并
隐藏对话框；试玩控制条渲染在舞台下方。编辑器重新获得窗口焦点或手动刷新时会检查最新 Story
revision；无本地待保存修改时自动载入，否则沿用 CAS 冲突处理。

线路报告把开放线路、不可达 Fragment、无出口循环和终止 Block 后的内容列为错误，把可退出循环列为
警告；缺失的 `ready` 故事图片或声音文件也会阻止完成。没有绑定背景的场景仍可使用确定性主题占位并完成。
只有零错误时工程才能标记为 `completed`，已完成工程
再次保存故事会自动回到 `draft`。上传图片属于工程私有素材，支持 PNG、JPEG、WebP 和 AVIF；上传声音支持
MP3、WAV、M4A 和 OGG。删除
工程时同时清理数据库记录和磁盘文件；从全局文件库选择只建立引用，引用解除或工程删除后释放原图。
公共文件接口不能修改或删除 Galgame 私有素材，全局图片在被 Galgame 故事引用时同样禁止删除。
Web 提供角色列表、资料、立绘与声线，场景列表、资料与背景，以及声音资源三栏工作区；图片和声音选择器
复用 650ms 串行自动保存和冲突处理。内置试玩会把背景置于角色立绘、对白和选择层下方，并独立管理
配音、BGM、环境音和最多八路音效，加载
失败时回退到确定性主题舞台。当前格式仅供工坊内部使用，不代表 LetsGal 原生工程或导入兼容。

## 图片与视频生成

- `GET /v1/visual-workshop/generation-options`：返回已启用的 SenseAudio 图片/视频模型及图片尺寸。
- `POST /v1/visual-workshop/projects/{project_id}/generation-tasks`：创建图片或视频异步任务。
- `GET /v1/visual-workshop/generation-tasks`：按项目、类型、状态分页筛选任务。
- `GET /v1/visual-workshop/generation-tasks/{task_id}`：读取单个任务。
- `POST /v1/visual-workshop/generation-tasks/{task_id}/retry-materialization`：只重试已生成结果的本地保存。

任务状态统一为 `queued / submitting / pending / processing / completed / failed`。本机执行器每
5 秒恢复和轮询任务，最多并发 4 个远端请求；只有结果通过 HTTPS 公网地址、重定向、文件大小、
MIME 与文件签名校验并原子写入项目素材后才进入 `completed`。远端失败需要新建任务，只有响应中
`can_retry_materialization=true` 的失败任务才能安全重试本地保存。任务与日志不保存 API Key、
Data URI 或素材内容。

图片任务可携带一张项目图片作为参考。视频界面提供文生视频、图生视频、首尾帧和全能参考；API
以纯文本、首尾帧或参考素材三种互斥模式表达，其中图生视频使用只有首帧的首尾帧模式。时长
4–15 秒，参考模式最多 9 张项目图片、3 个音频素材 ID 和 3 个视频素材 ID，且不能仅提供音频。
图片以 Data URI 发送；音频和视频由后端临时托管后再提交，临时 URL 不进入任务快照或日志。
执行器仍兼容升级前已排队任务中的旧 URL 字段。视觉模型不进入模型服务页的固定 `OK` 快速诊断，
但可在模型测试页执行真实生成测试。

## 文件管理与项目素材

- `GET/POST /v1/file-folders`：读取或创建文件管理/项目素材文件夹。
- `PATCH/DELETE /v1/file-folders/{folder_id}`：CAS 改名、移动或递归删除文件夹。
- `GET/POST /v1/files`：按项目、当前文件夹、搜索词、媒体类型和排序查询，或 multipart 上传单文件。
- `PATCH/DELETE /v1/files/{asset_id}`：CAS 改名、移动或删除文件。
- `GET /v1/files/{asset_id}/content`、`/download`：鉴权预览或下载原始内容。

不带 `project_id` 的文件和文件夹属于 Studio 一级“文件管理”；带 `project_id` 的内容属于项目
私有素材。项目导入公共文件时只建立引用，不复制磁盘内容；存在项目引用的公共文件或包含它的
文件夹返回 `409 asset_in_use`，必须先从相关项目移除引用。文件夹最多五层。

允许 JPEG、PNG、WebP、GIF、AVIF、MP4、WebM、MOV、MP3、WAV、M4A、OGG、PDF、TXT、
Markdown 与 JSON；服务端同时校验扩展名、MIME、文件头和配置的大小上限，JSON 还会执行完整语法解析。
文件使用随机存储键保存，
原始文件名不参与磁盘路径构造。

## 健康与鉴权

- `GET /health`
- `GET /ready`
- `GET /v1/studio/auth/check`
