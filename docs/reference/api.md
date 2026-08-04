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

调用源 `model_diagnostic` 表示模型服务行内的固定 `OK` 快速诊断，`model_playground` 表示模型测试工作台。

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

修改、删除、发送和重新生成使用会话 `expected_revision` 做 CAS 保护。发送请求可携带最多 5 个
`attachment_ids`，文本和图片至少提供一项。图片仅支持 JPEG、PNG、WebP 与静态 GIF，单张
最多 8 MiB、宽高最多 8000 像素；只有同时具有 `chat`、`vision` 能力的模型可处理图片。
图片随消息私有保存，成功轮次的历史图片会继续进入后续请求，重新生成复用原用户消息图片。
调用日志仅记录图片 MIME 与大小，不记录图片内容或磁盘路径。流式接口返回 SSE v2 envelope，
事件为 `start / delta / done / error`；成功、失败、超时或取消都会保存消息状态并写入调用日志。

模型测试页按供应商协议自适应：OpenAI/Anthropic 模型进入多轮对话，SenseAudio 图片/视频模型进入
独立异步生成测试。图片测试支持提示词、尺寸和种子；视频测试支持提示词、时长、分辨率、比例、
水印、生成音频，以及从本机素材库选择最多 9 张图片、3 个音频和 3 个视频。任务结果下载到 `model-test/generated/`，不创建视觉工坊项目或素材。任务与模型
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

项目类型为 `image / video / canvas`，状态为 `draft / completed`，标题长度为 1–120 字。
修改和删除必须携带项目的 `expected_revision`；冲突返回 `409 revision_conflict` 以及服务器
当前项目快照。Web 新建流程固定创建名为“未命名项目”的 canvas 项目并直接进入项目画布；
旧的 image/video 项目仍可按画布打开。画布文档保存文本、图片、视频和音频节点的标题、内容、
素材/生成任务引用与世界坐标，并使用独立于项目元数据的 `revision`。`PUT` 必须携带
`expected_revision`；冲突返回服务器画布快照，Web 不会静默覆盖。图片/视频节点创建生成任务后
保存任务 ID，任务完成时把结果素材回填到原节点。视口缩放和平移仍属于浏览器本地偏好。

项目对话标题和所选模型使用独立会话 revision 做 CAS；Web 可按供应商浏览并切换当前已启用的
`chat` 模型，生成期间禁止切换。发送准备与流式结算分别使用短事务，供应商网络等待不占用
写事务。发送时自动读取最新画布，把项目标题、节点 ID、类型、标题、位置、素材元数据和受限文本
上下文提供给助手，但不会暴露任何画布写入工具。只有已完成轮次进入后续上下文。系统自动选择首个
已启用的 `chat` 模型；附图时要求模型同时支持 `vision`，原模型失效会自动回退并通过 SSE `start`
事件提示。项目对话图片最多 5 张，单张最多 8 MiB，仅支持 JPEG、PNG、WebP 与 GIF；被消息引用的
素材返回 `409 asset_in_use`，必须先删除对应对话。SSE 使用 v2 `start / delta / done / error` 包络。
调用日志来源为 `visual_workshop_assistant`，记录系统指令、脱敏后的文本消息链、消息数量、画布摘要、
素材 ID 和文本回复，便于按角色检查实际模型上下文；附件只记录 MIME 与大小，不保存图片 Base64、
临时链接、磁盘路径、密钥或供应商原始事件。

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

允许 JPEG、PNG、WebP、GIF、AVIF、MP4、WebM、MOV、MP3、WAV、M4A、OGG、PDF、TXT 与
Markdown；服务端同时校验扩展名、MIME、文件头和配置的大小上限。文件使用随机存储键保存，
原始文件名不参与磁盘路径构造。

## 健康与鉴权

- `GET /health`
- `GET /ready`
- `GET /v1/studio/auth/check`
