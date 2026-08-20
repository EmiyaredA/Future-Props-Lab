# API 参考

交互式 OpenAPI 位于后端 `/docs`。所有业务接口注册在 `/v1`。浏览器使用 Cookie Session；写请求
同时校验 `fpl_csrf`/`X-CSRF-Token` 与精确 Origin。自动化可使用绑定单一 Workspace、以 `fpm_`
开头的 Bearer Management API Key，scope 仅有 `studio:read` 和 `studio:write`。

## 账号与 Workspace

- `POST /v1/auth/login`、`GET /v1/auth/me`、`POST /v1/auth/reauth`
- `POST /v1/auth/change-password`、`POST /v1/auth/logout`
- `PATCH /v1/account/profile` 与头像 GET/PUT/DELETE
- `GET/DELETE /v1/account/sessions/{session_id}`、`POST /v1/account/sessions/revoke-others`
- `GET/POST /v1/account/api-keys`、`POST /v1/account/api-keys/{key_id}/revoke`
- `GET /v1/account/security-events`
- `GET/POST /v1/platform/accounts`、账号状态更新、密码重置和全局安全审计
- `GET /v1/account/workspaces`、`POST .../switch`、`PATCH .../current`
- 当前 Workspace 的成员与邀请治理，以及本人邀请的接受/拒绝接口
- `GET /v1/public-workspace`、公开 Galgame Story 与受项目可达性约束的 inline 素材预览

业务请求不接受 `workspace_id`；当前空间只能来自已验证 Session 或 API Key。跨空间资源 ID 统一按
404 处理。公开 Workspace 也要求先登录，访客只获得独立只读作品投影，不能访问模型、提示词、
测试对话、任务、日志、账号或安全信息。

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
供应商类型额外包含 `senseaudio_asr`；内置但默认停用的 SenseAudio ASR Pro 1.5 与 ASR API
专业语音识别共用这一适配类型，仍不复用图片或视频供应商的 API Key。历史 Workspace 升级时，
ASR API 供应商会复制原 ASR 供应商的加密凭证与启用状态，仅把地址切换为
`/api/v2/asr/pro`；新 Workspace 的两项 ASR 供应商都默认停用且不包含凭证。

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
- `GET /v1/model-test/transcription-options`：返回已启用且声明 `speech_recognition` 的 SenseAudio ASR 或 OpenAI 兼容模型、支持格式、每个模型的上传上限，以及供应商无关的参数能力和默认值；ASR API 专业语音识别为 100 MB，其余当前模型为 10 MB。
- `POST /v1/model-test/transcription-tasks/upload`：multipart 上传 `upload`、`model_id` 与识别参数并创建持久化任务。
- `POST /v1/model-test/transcription-tasks`：通过 `model_id`、`source_asset_id` 与同名识别参数从当前 Workspace 文件管理复制音频并创建任务。
- `GET /v1/model-test/transcription-tasks`、`GET /v1/model-test/transcription-tasks/{task_id}`：分页查询或读取识别任务。
- `GET /v1/model-test/transcription-tasks/{task_id}/input-content`：鉴权试听任务的私有输入副本。
- `DELETE /v1/model-test/transcription-tasks/{task_id}?expected_revision=...`：CAS 删除完成或失败任务及其私有音频。

修改、删除、发送和重新生成使用会话 `expected_revision` 做 CAS 保护。发送请求可携带最多 5 个
`attachment_ids`，文本和图片至少提供一项。图片仅支持 JPEG、PNG、WebP 与静态 GIF，单张
最多 8 MiB、宽高最多 8000 像素；只有同时具有 `chat`、`vision` 能力的模型可处理图片。
图片随消息私有保存，成功轮次的历史图片会继续进入后续请求，重新生成复用原用户消息图片。
调用日志记录脱敏文本上下文、最终文本回复、会话 ID、首 Token、结束原因和轮次；图片仅记录 MIME
与大小，不记录图片内容或磁盘路径。流式接口返回 SSE v2 envelope，事件为 `start / delta / done /
error`；成功、失败、超时或取消都会保存消息状态并写入调用日志。

模型测试页按能力与供应商协议自适应：只有声明 `chat` 的 OpenAI/Anthropic 模型进入多轮对话，SenseAudio 图片/视频模型进入
独立异步生成测试。图片测试支持提示词、尺寸和种子；视频测试支持提示词、时长、分辨率、比例、
水印、生成音频，以及上传最多 9 张图片、3 个音频和 3 个视频到模型测试私有草稿区。创建任务会在
同一事务认领这些草稿；新任务不能引用公共 `visual_assets`。历史任务由显式回填 API 迁移，原公共
文件保持不动。任务结果下载到 `model-test/generated/`，不创建视觉工坊项目或素材。任务与模型
目录都通过 `/v1` API 管理，活动任务不可删除或随模型一起停用；终态删除使用 revision/CAS。

语音识别测试接受 MP3、WAV、M4A 与 OGG，扩展名、MIME 和文件头必须一致；文件非空且不自动
切片。ASR API 专业语音识别允许 100 MB，其余当前模型允许 10 MB；前后端都按所选模型校验。
两类创建接口统一接受可选的 `language`、`target_language`、`enable_word_timestamps`、
`enable_text_edit`、`enable_speaker_diarization`、`max_speakers`、`enable_punctuation`、
`hotwords` 与 `abbreviations`。上传接口使用同名 multipart 字段，文件库接口使用 JSON 字段。
不支持的非默认参数、非法语言、未开启说话人识别却设置人数，以及 1–20 之外的人数返回 `422`。
`stream=false`、`response_format=verbose_json`、模型名和同步模式由系统控制，始终请求句级时间轴。

参数能力按端点和模型返回：自定义 Pro 端点提供语言候选、翻译、字词时间戳、文本整理和说话人
识别；官方 Lite 提供热词，Standard 提供标点、说话人和时间戳，官方 Pro 增加翻译与最大说话
人数，DeepThink 只暴露同步请求有效的能力；OpenAI 兼容模型只显示其兼容项。默认开启自定义
Pro 的文本整理与说话人识别，以及官方 Standard/Pro 的标点和说话人识别；翻译、字词时间戳、
热词和缩写替换默认关闭。

本地上传与文件管理来源都会复制到当前 Workspace 的
`model-test/references/`，因此源文件删除后任务仍可试听。单机 Runner 执行
`queued → running → completed/failed`；启动时将中断的运行中任务标记失败，避免重复付费。
SenseAudio 结果包含全文、说话人和句级起止时间；ASR API 的嵌套 `result.utterances`、毫秒时间戳
与重叠说话人候选会归一化为同一分段结构。任务详情还保存译文、字词时间戳、音频信息、处理
阶段、重叠区间和脱敏警告；OpenAI 兼容供应商未返回分段时使用空数组。任务和调用日志保存提交
时的完整参数快照，不受后续表单默认值或模型配置变化影响。完成或失败均写入
`model_playground` 调用日志，日志不保存 API Key、音频字节、供应商原始响应或磁盘路径。

## 工具导航

- `GET /v1/tool-navigation/state`：读取工具收藏与最近使用状态。
- `PATCH /v1/tool-navigation/tools/{tool_id}`：通过 `is_favorite` 幂等更新收藏状态。
- `POST /v1/tool-navigation/tools/{tool_id}/use`：原子递增使用次数并更新最近使用时间。

工具目录本身由 Web 注册表维护，后端只保存由小写字母、数字和连字符组成的稳定工具 ID。
状态属于当前 Workspace，同一工具可在不同空间保存独立偏好。

## 录音分段标注

- `GET/POST /v1/audio-annotation/projects`：搜索或创建当前 Workspace 的录音标注任务。
- `GET/PATCH/DELETE /v1/audio-annotation/projects/{project_id}`：读取、重命名或删除任务。
- `GET/PUT /v1/audio-annotation/projects/{project_id}/document`：读取或完整保存说话人和片段文档。
- `GET/PUT /v1/audio-annotation/projects/{project_id}/waveform`：读取或保存浏览器生成的预计算峰值。
- `POST /v1/audio-annotation/imports`：把版本化项目 JSON 与选定的文件库音频原子导入为新任务。
- `POST /v1/audio-annotation/transcription-imports`：从已完成的模型测试识别任务直接创建标注任务，
  或把 `future-props-transcription` 1.0/1.1 JSON 与选定音频转换为新任务。

创建和导入只接受当前 Workspace 公共文件库中的音频，单文件最多 100 MiB、时长最多 60 分钟；
音频时长由服务端读取。文档固定使用 `schema_version: "1.0"`，最多 64 位说话人和 5000 个片段。
片段最短 100 毫秒，允许留空白和时间重叠，但必须按开始时间排序，说话人引用必须存在。
多人同时说话用各自的重叠片段表示。每个片段的 `text` 可通过 `language` 指定原文语言，并用
`localized_texts` 保存最多 32 份其他语言文本；同一片段内语言不得重复，未提供时兼容旧文档。
文档和波形
分别通过 `expected_revision` 做完整资源 CAS，冲突返回 `409 revision_conflict` 和服务器当前快照。
波形最多双声道、每声道最多 36,000 个峰值。删除任务只删除标注数据；原音频继续保留，且在被
任务引用期间从文件管理删除会返回 `409 asset_in_use`。

模型测试识别结果导出供应商无关的 `future-props-transcription` 1.1 JSON，文件保存源音频元数据、
模型和完整参数快照、全文、毫秒级分段，以及标准化的译文、字词时间戳、重叠和处理信息；导入
仍兼容 1.0。导入时已知说话人按名称去重，`unknown` 映射为未指定，译文和高级详情不进入标注，
标注始终使用原语言识别文本，
所有片段均标记为待校对；只有全文而没有时间戳时创建覆盖完整音频的单片段。直接导入优先复用仍
存在的文件库源音频，否则把任务私有输入副本复制到文件库根目录。重叠的识别分段会原样保留，
短于 100 毫秒的识别分段会自动忽略；无内容或越界的分段返回 `422`，不会静默修改。

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

## 文件存储布局

- `GET /v1/file-storage/layout`：返回目标版本、待迁移项目/素材、待迁移字节数、缺失或冲突文件计数与完成状态。
- `POST /v1/file-storage/layout/migrate?limit=50`：顺序迁移 1–100 个旧版素材；逐文件复制、校验大小与 SHA-256、原子落盘并以 `storage_version` CAS 结算。问题码固定为 `source_missing`、`target_conflict`、`copy_failed`，失败素材保持原状态，可重复调用继续迁移。

两个接口使用 Studio 鉴权；旧布局在完成前保持可读，新上传文件始终写入版本 2 项目目录。

## Galgame 工坊

- `GET/POST /v1/galgame-workshop/projects`：按最近更新时间读取工程或新建空白工程。
- `GET/PATCH/DELETE /v1/galgame-workshop/projects/{project_id}`：读取、修改或删除单个工程。
- `GET/PUT /v1/galgame-workshop/projects/{project_id}/story`：读取或整份 CAS 保存 Story 1.4 故事文档。
- `GET /v1/galgame-workshop/projects/{project_id}/story/report`：按章节顺序、调用栈与真实控制流检查可达性、停止点和递归。
- `GET/POST /v1/galgame-workshop/projects/{project_id}/assets`：搜索或上传工程私有的图片、音视频、字体与参考文档；上传可指定素材分类。
- `POST /v1/galgame-workshop/projects/{project_id}/assets/import-preview|batch`：预检批量改名和虚拟路径，或原子导入一批素材。
- `PATCH /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}`：以素材 revision CAS 修改显示名、分类、虚拟路径与打包策略。
- `GET /v1/galgame-workshop/projects/{project_id}/assets/overview`：返回数量、体积、类型分布、打包估算、引用位置、游离与缺失文件。
- `POST /v1/galgame-workshop/projects/{project_id}/assets/metadata-scan`：重扫 Hash、图片尺寸和音视频时长。
- `GET /v1/galgame-workshop/projects/{project_id}/assets/package-manifest`：按有效引用与强制策略生成打包清单，并报告阻断问题。
- `POST /v1/galgame-workshop/projects/{project_id}/assets/repair`：以 Story revision CAS 重新绑定缺失引用。
- `GET/PATCH /v1/galgame-workshop/projects/{project_id}/assets/asr/settings`：读取或 CAS 修改 ASR 模型、语言和并发。
- `GET/POST /v1/galgame-workshop/projects/{project_id}/assets/asr/transcriptions`：读取任务或批量创建待处理/强制识别任务。
- `PATCH /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}/transcript`：以文本 revision CAS 手工修正识别文本。
- `POST /v1/galgame-workshop/projects/{project_id}/assets/asr/match-dialogue`：归一化文本后稳定匹配对白并以 Story CAS 绑定语音；可通过 `blockIds` 只匹配指定对白，省略时匹配全项目。

项目素材响应的 `transcriptSegments[]` 与转写任务的 `resultSegments[]` 使用统一的
`{ speaker, startMs, endMs, text }` 形状。SenseAudio ASR Pro 请求启用说话人分离、自动标点和
句级时间戳；音频按所选模型的 10 MB 或 100 MB 上限校验，超限时不会提交供应商。手工修正整段文本会清空旧分段，
避免结构化结果与新文本不一致；检测得到的 `speaker_*` 仅用于展示，不自动绑定剧本角色。

- `GET/POST /v1/galgame-workshop/projects/{project_id}/story/portrait-upgrade`：预览或应用旧立绘尺寸升级；应用前自动保存快照。
- `GET /v1/galgame-workshop/projects/{project_id}/story/snapshots` 与 `POST .../{snapshot_id}/restore`：列出并以 Story revision 恢复维护快照。
- `DELETE /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}`：按素材 revision 删除未被故事使用的工程素材；引用冲突返回可定位的角色、Fragment 与 Block 信息。

工程状态为 `draft / completed`，标题长度为 1–120 字。修改和删除必须携带工程的
`expected_revision`；冲突返回 `409 revision_conflict` 以及服务器当前工程快照。新建工程会同时
写入 `schemaVersion: "1.4"` 故事文档，预置 `chapter-1` 章节和入口为 `main` 的空 Fragment。
故事包含 `synopsis`、`entryChapterId`、类型化变量、角色属性模板、角色、场景、剧情 CG、项目级
`settings` 及
`chapters → fragments → blocks`。章节有稳定 ID、顺序、入口 Fragment 和禁用状态；入口章不能删除或禁用，
`endChapter` 会进入下一启用章。旧 `schemaVersion: "1.0/1.1"` Story 读取时自动补齐这些字段并升级为
`schemaVersion: "1.4"`，继续使用整份文档 revision CAS。`settings.canvas` 保存 640×360 至
7680×4320 的画布尺寸（默认 1920×1080）；`settings.characterStage` 保存全局锚点、基准画面高度、
默认位置 ID 与 1–20 个可排序的二维百分比位置预设，其中左、中左、中、中右、右五个内置预设必须保留。
`settings.characterStageOverrides` 可按角色 ID 保存同形的独立方案；键必须引用现有角色，删除条目后角色恢复跟随全局方案。
旧版标量站位会结合共享 Y 坐标自动转换为二维预设。角色舞台配置是运行时站位、锚点与基准尺寸的
唯一事实源；对白人物呈现和角色登场 Block 只保存 `positionId` 与 `far / medium / near` 距离档位。
角色的 `themeColor` 使用六位十六进制颜色；旧文档按角色顺序补入
确定性色板。角色可选
`expressions[]` 和 `defaultExpressionId`，表情通过故事
`assets[]` 中的 `characterPortrait` 记录引用文件，并可用 `flipX` 保存表情在舞台上的默认水平朝向；
该朝向与 Block 的 `transform.flipX` 叠加，两次翻转会互相抵消，且不影响原图、编辑器缩略图或对白头像。
Story 1.4 的表情可用 `renderMode: frameSequence` 和
`sequence: { playbackMode, fps, loop, frames[] }` 组织 1–240 张静态图片帧；帧 ID 在表情内唯一，FPS 默认为 2、范围为 1–60，
`assetId` 始终等于首帧素材。编辑器预览和试玩播放器会预加载后逐帧播放，关闭循环后停在末帧；
`playbackMode` 默认为 `timed`。设为 `lipSync` 时必须依次保存闭口、半口、张口三帧，编辑器仍可循环预览，
试玩时则由当前对白配音的音量驱动，并在静音、暂停、非说话角色或关闭口型同步时固定使用闭口首帧；
对白头像、表情卡缩略图和立绘皮肤覆盖仍使用静态代表图。Spine 与 Live2D 只作为未启用的扩展入口，
当前契约不接受其资源包。
对白可用 `expressionId` 覆盖角色默认表情。场景统一使用
`sceneGroups + scenes[].layers[]`；每层保存稳定 ID、名称、`sceneLayer` 素材、距离和偏移，单层与多层共享模型。
旧多背景场景会确定性拆分为多个场景并重写 Scene Block 引用；`clearCharacters` 控制切换场景时是否清空舞台角色。
`showCharacter` Block 以 `characterId` 为舞台唯一实例进行登场或调整，保存表情、资产位置预设 ID、
距离档位、亮度、透明度、水平翻转、层级与基础过渡；`removeCharacter` 可让指定角色或全部角色退场。
旧 `transform.x / y / anchor / scale` 字段继续接受和原样保存以兼容既有 Story，但播放器不再用它们覆盖
角色资产配置。故事保存使用独立
`expected_revision`，严格拒绝重复 ID、悬空引用、跨角色表情、越界角色变换、跨场景背景和少于两个选项的分支；冲突快照包含服务器当前完整故事，
旧版 V1 缺少立绘或背景字段时在读取中补默认空值，首次保存后自然写入扩展格式。项目变量声明
`boolean / number / string` 类型、默认值和 `session / persistent` 生命周期；角色属性只能使用项目属性模板中
声明的键和值类型。

Story 1.4 可选的 `localizations` 保存人工翻译：`sourceLocale` 为源语言，`defaultLocale` 为游戏启动
语言，`targets[]` 按 BCP-47 语言标签保存译文。每条 `entries[]` 通过稳定的
`blockId + field + choiceId?` 引用玩家可见字段，并同时保存 `sourceFingerprint` 与纯文本译文；不复制
Block，也不改变章节、Fragment、分支目标或时间轴。目标语言与翻译引用在各自作用域内必须唯一，
`choiceText` 必须携带存在于对应 Branch Block 的 `choiceId`。播放器可显式指定 locale，否则使用
`defaultLocale`；缺失、空白或源文指纹过期的译文回退 `sourceLocale`。没有 `localizations` 的旧 Story
继续按 `zh-CN` 运行。

Block 使用一个带 `type` 判别字段的联合契约。除既有场景、角色、CG、对白、声音、分支和章节结束外，
还包含段落与参数、系统消息、注释、等待、销毁场景、镜头与复位、粒子、舞台动画、浮动文字、幕布、
视频、精灵动画、自动播放、对话框样式、立绘发言规则、鉴赏、条件、变量赋值、调用 Fragment 和返回入口章。
扩展方法、扩展界面与任意自定义运行时 Block 不在该联合类型中。条件表达式只允许读取已声明变量与角色属性，
不会执行 JavaScript。

`cgs[]` 独立维护剧情 CG，不作为场景背景差分使用。每项 CG 最多包含 100 个 `variants[]`，图片必须引用
`storyCg` 素材；存在差分时必须设置有效的 `defaultVariantId`。`showCg` Block 显式显示或替换 CG，
`variantId: null` 跟随默认差分。`displayMode: fullscreen` 保持传统全屏 CG，`fit` 支持铺满裁切的
`cover` 和黑边完整显示的 `contain`；`displayMode: overlay` 在场景上等比叠加图片，`overlay` 保存中心点
百分比坐标、舞台宽度百分比、透明度以及角色前方/后方两档位置。`hideCg` 显式隐藏当前 CG，没有活动 CG
时是确定性空操作。全屏 CG 和前景叠加 CG 覆盖角色，后景叠加 CG 位于背景与角色之间；自定义 UI、对话框、
选项和系统交互继续显示在其上方。切换场景和分支跳转不会隐式隐藏 CG，章节结束和重新试玩会清空。旧 V1
故事缺少 `displayMode` 时按 `fullscreen` 读取，缺少叠加参数时使用居中、60% 宽度、完全不透明和角色前方；缺少
`cgs` 时读取为 `[]`，保存后统一写为 `schemaVersion: "1.1"`。

Dialogue Block 的 `characterId` 继续表示主说话角色；可选 `speakerIds` 表示同一句对白由多人同时说出，
第一项必须与 `characterId` 相同、角色不能重复且都必须存在。缺少 `speakerIds` 的旧故事仍按单人对白处理。
对话框按顺序显示全部说话人，已在舞台上的说话角色会同时获得说话人聚焦与口型响应；本句的
`expressionId`、`portrait` 和 `voiceAssetId` 仍由主说话角色承载，避免破坏已有单句配音和立绘数据。

对白的可选 `portrait` 保存 `stage / dialogueAvatar / soloLegacy` 模式、`visible`、皮肤、对白后是否保留、
可选角色变换与过渡。旧 `hidden` 读取为 `stage + visible:false`，旧 `solo` 读取为 `soloLegacy`；缺少
`portrait` 的旧对白继续使用单人临时立绘，新建对白默认加入多人舞台并保留角色。`stage` 模式未指定
变换时继承角色当前舞台状态，不在场时使用底部居中的默认变换。

旁白、对白和剧情段落可保存 `content: { version: 1, nodes: [...] }` 结构化富文本；存在 `content` 时它是
正文真源，服务端同步生成兼容 `text` 摘要。节点支持文本粗体、斜体、删除线、前景/背景色、8–200px 字号、
注音、变量、换行、定时或玩家继续等待；只有对白允许内联表情切换。角色可配置固定值或字符串变量驱动的
`displayNames`、从当前表情立绘裁切的 `dialogueAvatar`，以及按表情 ID 覆盖素材的 `portraitSkins`。

`storyParagraph` 以全屏连续段落呈现，`textSpeedCps: 0` 表示继承项目默认速度。`paragraphParams` 是只影响
后续段落的增量指令，支持速度、淡入、揭示效果、阅读态、0–100 条历史上限和样式引用；所有字段为空时拒绝
保存。旧正数 `textSpeedMs` 换算为字符/秒，`0ms` 迁为即时显示，旧 `autoAdvanceMs / skippable` 不再生效。
`systemMessage` 的提示模式为单按钮，确认模式为双按钮并可把结果写入布尔变量；取消、Esc 和异常关闭写入
`false`。`wait` 使用 `duration / player` 两种模式，玩家继续等待不受自动播放或跳过影响。注释仅供作者查看，
不进入运行时和时长计算。

`curtain` 使用 `fullscreen / letterbox / pillarbox / frame` 分别表示全屏、上下黑边、左右黑边和四周黑边，
并通过 `show / hide` 合上或打开幕布。缺少 `mode` 的旧 Block 按 `fullscreen` 读取；颜色、不透明度、动画时长
和 `waitForCompletion` 继续决定渲染与剧情推进。该扩展继续随 Story 1.4 文档保存，不需要持久层迁移。

`presentation.text` 保存全局文字速度，`presentation.paragraph` 保存内置或项目段落样式，
`presentation.systemMessage` 保存标准消息框槽位和项目消息框样式。引用统一为
`{ source: builtin | project | extension, id }`；缺失的扩展或项目样式产生线路警告并在运行时回退内置样式，
角色、变量、表情和素材等硬引用仍严格拒绝悬空值。

`presentation.dialogueBox` 保存工坊内置试玩的全局对话框外观，包括预设、底色、正文与角色名颜色、
透明度、圆角和字号。可选 `assetId` 必须引用 `assets[]` 中 role 为 `dialogueBox` 的静态图片；上传图片
与角色立绘、场景背景复用同一套工程私有素材和全局文件引用生命周期。旧 V1 故事缺少
`presentation` 时读取为默认暗色对话框，首次修改后随 Story CAS 整体保存。
`presentation.stage` 保存多人舞台的说话者自动聚焦开关、非说话者亮度倍率、聚焦过渡时长与
`lipSyncEnabled`。角色基础亮度始终保存在具体演出 Block，自动聚焦只在试玩渲染时叠加，不改写故事
数据。口型开启后，运行时以无对白区间采样的底噪为基准，在表情设置的 FPS 上限内把 `lipSync` 序列的
闭口、半口和张口三帧映射为三档音量口型；旧工程的 `f000 / f001 / f002` 三表情命名继续兼容。
旁白、暂停、无对白和非说话者保持闭口，缺少配套差分的素材静默回退到作者指定的表情。

`presentation.ui.components` 保存项目级自定义 Gal 界面组件。组件不预设为日期 HUD、快捷栏或其他
固定用途；每项自行定义 `name`、`assetId`、百分比坐标 `x` / `y`、百分比宽度 `width`、显示时机
`visibility` 与叠放层级 `layer`。组件图片统一使用 `uiComponent` 素材角色，编辑器支持任意增删、上传、
从文件库选择、替换和移除。旧版固定界面槽位在读取时会迁移为普通自定义组件。

故事声音与图片共用 `assets[]`，音频素材使用 `type: audio` 和
`voiceSample / voiceLine / backgroundMusic / ambientSound / soundEffect` 角色。角色可通过
`voiceProfile` 保存声线名称、语言、描述和试听样本；对白通过 `voiceAssetId` 与 `voiceVolume`
绑定逐句配音。`audio` Block 显式控制 `bgm / ambient / sfx` 通道的播放、停止、音量、循环和
淡入淡出；BGM 与环境音不会从场景隐式继承。Fragment 可选 `timeline: { durationMs }`，其中
`durationMs` 是独立的剧情总长。对白、旁白、剧情段落或系统消息通过成对的 `startMs / endMs` 绑定剧情时间轴；`scene`、`showCharacter`、
`removeCharacter`、`showCg`、`hideCg` 与 `audio` Block 可用 `atMs` 固定触发点。无时间轴的 Fragment 拒绝这些时间字段；
有时间轴时所有显式时间都不能超过剧情总长，对白/旁白还必须有序且互不重叠。

编辑器把一次 `showCg` 到下一个 `showCg`、`hideCg` 或时间轴末尾派生为可拖动、可调整双端的 CG 显示区间。
调整没有显式结束事件的区间时会补充 `hideCg`；相邻 CG 的替换时间是共享边界，区间最短 100ms。

同一时刻允许一个场景状态、一个 CG 事件、多个不同角色和多个 SFX；BGM 与环境音各自只允许一条播放事件，但允许
先停止再播放以交叉淡化。同一时刻的归约顺序固定为：场景切换、角色退场、角色登场/调整、CG
显示/隐藏、持续声音停止、持续声音播放、SFX、对白/旁白，同类事件保持原 Block 顺序。缺少 `atMs` 的
`showCharacter / removeCharacter` 跟随 Block 顺序中的下一句对白；没有后续对白时跟随剧情结尾。移动对白时这些
角色事件一起移动，只有单独拖动角色事件后才保存显式 `atMs` 并转为独立演出。其他缺少 `atMs` 的旧舞台或声音事件
仍按兼容规则解释：首句前为 0，对白之间锚定下一句开始，尾部锚定剧情结尾。时间轴中的正式 BGM 会跟随播放、暂停与跳转；
非循环 BGM 超过媒体时长后保持结束状态。

角色舞台位置由角色资产的二维百分比预设保存，运行时 Block 通过 `positionId` 引用；对白卡片可选择
远、中、近距离档位与位置预设。位置预设被删除或旧引用无法解析时自动回到该角色的默认位置。旧 Block
的自由坐标仅作格式兼容，不参与新的舞台布局。

剧本编辑器使用章节树、卡片正文和舞台/检查器三栏布局。“卡片 / JSON”位于主视图标签组，
“演出”作为独立工作区入口；三者读取同一组 Block。JSON OP 是当前 Fragment 的顶层只读检查视图，
支持复制但不会修改剧本。卡片视图负责按顺序创作，
可就地编辑对白和旁白，并直接设置对白主角色、表情、已有配音、立绘模式与句后状态；连续且说话人集合相同的对白
显示为一组。普通新增 Fragment 与 Block 不创建 `timeline`，仅切换到演出视图也不会保存。演出视图按真实时间比例显示
场景、CG、对白/角色/配音、BGM、环境音、SFX 和分支/结局标记；固定轨道栏与时间内容区分离。跟随对白的角色事件
合并为对白上的演出标记，显式
`atMs` 角色事件以独立时间点显示。工具栏“演出细节”按需展开逐角色轨，精确设置可逐个隐藏这些轨道而不删除事件。
用户直接选择各轨 Block 或无对白区间并在右侧编辑属性，分支与结局单独显示为终点标记。角色事件属性可在
“独立时间”和明确指定的目标对白之间切换；重新吸附保持 Block ID、移动到目标对白前并删除 `atMs`。对白支持共享分界拖动、
首尾边界、片段平移、100ms 吸附、
波纹编辑和 `mm:ss.mmm` 精确
输入。波纹编辑开启时，拉伸所选对白的右边界只改变该对白的结束时间，并以同一增量平移全部后续
对白的开始和结束时间；后续对白时长、对白间空隙和舞台事件所属 Block 均保持不变。波纹收缩释放的
空间留在剧情时间轴尾部，向右波纹扩展则同步增长剧情总长并保留原有结尾留白，且单句始终至少
100ms；这一
语义同时适用于右边界拖动、边界键盘微调、精确结束时间输入和“播放头设为结束”。关闭波纹编辑后
仍使用共享分界、单块裁切和空隙编辑，开始边界与 Gap 编辑不会触发后续连锁移动。开场、内部与结尾的无对白区间由相邻对白边界和时间轴总长推导，不创建 Gap Block；选中后可直接
编辑其有效边界。工具栏展示可精确编辑的剧情总长；普通末尾裁切、Block 右移、
精确结束时间和播放头设为结束越过当前末尾时也会自动扩展剧情总长，手动缩短则不能早于最后一个
Block。同时间同类事件的执行顺序在右侧属性检查器调整。时间轴还提供 300ms 预听、所选对白循环、
播放头设为起止点，以及在播放头添加对白、
旁白、舞台、声音、分支或结局。旧 Fragment 进入演出视图时只按正文估时生成只读
投影，不触发保存；首次拖动、修改时间或在播放头添加事件时才物化精确时间轴。单句默认
`max(1500ms, 字符数 × 180ms + 400ms)`，句间留白 300ms、结尾留白 500ms。所有合法修改仍通过整份
Story CAS 自动保存。卡片/演出视图偏好、内容项选择、舞台高度、舞台视口比例（自动 / 16:9 / 16:10 / 4:3 / 自定义）、
舞台折叠、时间轴播放头、缩放、循环与波纹编辑偏好只存在于浏览器，不进入故事文档；舞台与时间轴
默认约为 42/58，可拖动分隔线调整，也可折叠舞台预览以放大时间轴。试玩时下方时间轴只读跟随当前
Fragment、当前 Block 和播放头，退出试玩后恢复此前编辑选择。编辑时间轴时会试听当前正式 BGM，
并按播放事件起点计算媒体位置。编辑器重新获得窗口
焦点或手动刷新时会检查最新 Story
revision；无本地待保存修改时自动载入，否则沿用 CAS 冲突处理。

线路报告将终止指令后的内容、悬空引用、不可达章节或 Fragment、无出口递归及没有可达最终停止点列为错误，
把禁用章和可退出递归列为警告；Fragment 自然结束是合法停止，不再视为开放断点。缺失的 `ready` 故事图片、
声音或视频文件也会阻止完成。没有绑定背景的场景仍可使用确定性主题占位并完成。
只有零错误时工程才能标记为 `completed`，已完成工程
再次保存故事会自动回到 `draft`。上传图片属于工程私有素材，支持 PNG、JPEG、WebP 和 AVIF；上传声音支持
MP3、WAV、M4A 和 OGG；视频支持 MP4、WebM 和 MOV。删除
工程时同时清理数据库记录和磁盘文件；从全局文件库选择只建立引用，引用解除或工程删除后释放原图。
公共文件接口不能修改或删除 Galgame 私有素材，全局图片在被 Galgame 故事引用时同样禁止删除。
Web 顶层提供“剧本 / 资产 / 叙事地图 / 个性化 / 设置”。资产中心侧栏包含资源总览、角色、场景、BGM、音效和语音；剧情 CG 位于
场景二级页签，环境音位于音效二级页签，视频只在资源总览和 Video Block 选择器中出现。图片、声音和视频选择器
复用 650ms 串行自动保存和冲突处理。内置试玩会把背景置于角色立绘、对白和选择层下方，并独立管理
配音、单路 BGM、单路环境音和最多八路音效。试玩默认手动推进，也可切换自动播放；两种模式共用同一
剧情时钟和状态归约器。手动模式运行到下一句对白或旁白开始前并等待点击；首句前的演出先播放，纯演出
Fragment 播放到结尾。自动模式连续按精确时间推进；选择出现时两者都会暂停。对白采用两段式点击：
尚未完整时先显示全文，完整后再进入下一步。跳转会重建目标时刻的场景、角色与持续声音状态，不补播
中间的一次性 SFX；当前配音以 80ms
淡出。没有精确时间轴的旧 Fragment 仍可按配音结束后 400ms 或文本估时自动播放。声音加载
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
- `POST /v1/visual-workshop/projects/{project_id}/asset-imports`：批量导入公共库引用，或把其他视觉项目素材复制为当前项目的独立副本。

不带 `project_id` 的文件和文件夹属于 Studio 一级“文件管理”；带 `project_id` 的内容属于项目
私有素材。项目导入公共文件时只建立引用，不复制磁盘内容；存在项目引用的公共文件或包含它的
文件夹返回 `409 asset_in_use`，必须先从相关项目移除引用。跨项目导入会复制文件和素材元数据，
因此来源素材或来源项目后续删除不会影响目标项目。批量复制任一项失败时不会保留部分结果或临时文件。
文件夹最多五层。

允许 JPEG、PNG、WebP、GIF、AVIF、MP4、WebM、MOV、MP3、WAV、M4A、OGG、PDF、TXT、
Markdown 与 JSON；服务端同时校验扩展名、MIME、文件头和配置的大小上限，JSON 还会执行完整语法解析。
文件使用随机存储键保存，
原始文件名不参与磁盘路径构造。

## 健康与鉴权

- `GET /health`
- `GET /ready`

健康探针保持匿名；所有 `/v1` 业务接口按本页“账号与 Workspace”规则鉴权。
