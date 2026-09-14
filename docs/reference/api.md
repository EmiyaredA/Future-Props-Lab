# API 参考

## 文档编辑历史

以下接口位于 `/v1/thought-workshop`，鉴权沿用文档 Workspace 访问规则，跨空间的文档或历史 ID 返回 404：

- `GET /notes/{note_id}/history?cursor=&limit=30`：按 revision 倒序返回摘要（ID、revision、作者、服务器时间、来源与修改字段），以及下一页 `next_cursor`；limit 为 1–100。cursor 为上一页最后一条历史 ID。
- `GET /notes/{note_id}/history/{history_id}`：返回 `current` 和 `previous` 富文本快照；第一条记录的 previous 为 null。
- `POST /notes/{note_id}/history/{history_id}/restore`：请求包含 `expected_revision`；恢复标题、正文和标签，保留目录、收藏、置顶，返回更新后的文档并追加还原记录。缺少 revision 返回 422，冲突返回 409 与当前快照。

内容保存和历史写入在同一事务完成，重复内容、收藏和目录变更不会产生正文快照。创建、首页和导入同样记录历史。历史作者由认证 Principal 获取；迁移前的历史不可重建，基线作者显示未知。

完整备份版本为 v5，新增 `history` 和历史引用的附件；导入兼容 v1–v4。导入的历史账号 ID 清空，仅保留作者名称和原时间，导入动作追加当前操作者记录。历史无自动过期，回收站仍保留；永久删除文档时级联释放历史引用。

交互式 OpenAPI 位于后端 `/docs`。所有业务接口注册在 `/v1`。浏览器使用 Cookie Session；写请求
同时校验 `fpl_csrf`/`X-CSRF-Token` 与精确 Origin。自动化可使用绑定单一 Workspace、以 `fpm_`
开头的 Bearer Management API Key，scope 仅有 `studio:read` 和 `studio:write`。

## 账号与 Workspace

- `POST /v1/auth/login`、`GET /v1/auth/me`、`POST /v1/auth/reauth`
- `POST /v1/auth/change-password`、`POST /v1/auth/logout`
- `PATCH /v1/account/profile` 与头像 GET/PUT/DELETE
- `GET/DELETE /v1/account/sessions/{session_id}`、`POST /v1/account/sessions/revoke-others`
- `GET/POST /v1/account/api-keys`、`POST /v1/account/api-keys/{key_id}/renew|revoke`、`DELETE /v1/account/api-keys/{key_id}`。续期与删除必填 `expected_revision`；续期保持原密钥，从原到期时间或服务器当前时间中较晚者继续延长。
- `GET /v1/account/security-events`
- `GET/POST /v1/platform/accounts`：搜索、状态/平台身份筛选、服务端分页与创建（邮箱、管理员身份）。
- `PATCH /v1/platform/accounts/{user_id}`：状态或平台身份变更，必填 `expected_revision`。
- `POST /v1/platform/accounts/{user_id}/reset-password`：必填 `expected_revision`，临时密码只返回一次。
- `GET/POST /v1/platform/workspaces`：分页查询或指定启用账号为拥有者创建额外空间。
- `GET /v1/platform/security-events`、`GET /v1/account/workspaces/current/audit-events`：分页及事件、操作者、目标账号、时间范围筛选。
- `GET /v1/account/workspaces`、`POST .../switch`、`PATCH .../current`
- `PATCH /v1/account/workspaces/current/members/{membership_id}`：角色和 `expected_revision`。
- 当前 Workspace 的邀请创建支持 `role=admin|member|viewer`，默认 `member`；接受/拒绝/撤销必填版本。
- 固定角色、有效权限、密钥降权与升级兼容细节见[账号与工作区治理](account-governance.md)。
- `GET /v1/public-workspace`、公开 Galgame Story 与受项目可达性约束的 inline 素材预览

业务请求不接受 `workspace_id`；当前空间只能来自已验证 Session 或 API Key。跨空间资源 ID 统一按
404 处理。公开 Workspace 也要求先登录，访客只获得独立只读作品投影，不能访问模型、提示词、
测试对话、任务、日志、账号或安全信息。

## 模型目录

- `GET /v1/model-categories`：返回模型类别字典及对应的 `type/sub_type`。
- `POST /v1/model-suppliers`：创建当前工作区的供应商分组。
- `PATCH/DELETE /v1/model-suppliers/{supplier_id}`：重命名或删除空分组。
- `GET/POST /v1/model-providers`
- `PATCH/DELETE /v1/model-providers/{provider_id}`
- `POST /v1/model-providers/{provider_id}/enabled`
- `POST /v1/model-providers/{provider_id}/models`
- `PATCH/DELETE /v1/model-entries/{model_id}`
- `POST /v1/model-entries/{model_id}/test`

目录写入必须携带最后读取的 `expected_catalog_revision`。冲突返回 `409 revision_conflict` 和服务器当前快照。
目录响应包含 `suppliers` 和 `providers`；Provider 表示接入连接，`supplier_id` 为可空的分组归属，
`kind` 表示接入协议/适配类型，不代表供应商身份。历史连接保留 ID、凭证与模型引用，初始归入
界面的“未分组”。创建分组只接受名称，连接地址和密钥仍由连接独立维护。
更新连接时省略 `supplier_id` 保留归属，显式 `null` 解除归属；启停接口同样保留归属。
非空分组删除返回 `409 resource_busy`，不会级联删除连接或模型；跨工作区 ID 返回 404。
分组输出 `origin`、`template_key`、`managed_fields`，平台模板管理的分组不允许在工作区重命名或删除。
模板字段权限由服务端判断，客户端不能通过提交来源字段解锁。供应商写入与连接、模型共用目录 CAS。
模型的 `capabilities` 描述实际输入和调用能力，`categories` 描述模型用途并允许多选；两者都只通过
模型创建/更新 API 写入。类别字典参考 SiliconFlow 的 `type/sub_type` 语义，当前包含文本生成、
其他通用模型、语音合成、语音识别、音乐生成、视频生成、图片生成和端到端语音模型。
供应商类型额外包含 `senseaudio_asr`；内置但默认停用的 SenseAudio ASR Pro 1.5 与 ASR API
专业语音识别共用这一适配类型，仍不复用图片或视频供应商的 API Key。历史 Workspace 升级时，
ASR API 供应商会复制原 ASR 供应商的加密凭证与启用状态，仅把地址切换为
`/api/v2/asr/pro`；新 Workspace 的两项 ASR 供应商都默认停用且不包含凭证。

端到端实时语音使用供应商类型 `senseaudio_realtime`、模型能力 `voice` 和既有类别
`end_to_end_speech`。内置模型为 `senseaudio-realtime-1.0`，默认上游地址为
`wss://api.senseaudio.cn/ws/v1/realtime/voice-dialog`。历史 Workspace 只有在已启用、地址精确为
`https://api.senseaudio.cn/v1` 的 SenseAudio 供应商存在密钥时，才复制其加密凭证并启用实时供应商；
否则保持无密钥和停用。实时供应商只接受远程 `wss://` 或本机回环 `ws://`，其他供应商继续使用
HTTPS 或本机回环 HTTP 规则。

测试调用使用固定提示词、16 个最大输出 Token 和 30 秒超时；无论上游成功、失败或超时均记录日志，API Key 不进入请求或日志 payload。

## 调用日志

- `GET /v1/llm-call-logs`：支持搜索、调用源、供应商、模型、状态、日期和分页。
- `GET /v1/llm-call-logs/stats`：当前工作区今日统计（UTC），不受列表筛选影响。
- `GET/DELETE /v1/llm-call-logs/{log_id}`
- `GET /v1/llm-call-logs/{log_id}/reproduction-bundle`：下载不含密钥的 ZIP 复现包。
- `POST /v1/llm-call-logs/batch-delete`

列表参数 `q` 搜索模型、日志 ID 或 Trace ID；`call_source`、`provider_kind`、`model`、`status` 精确筛选，
`from`/`to` 支持 ISO 日期或时间，日期包含当天起止、带偏移时间统一转换 UTC。非法日期、反向区间或
非法筛选值返回 422。`page_size` 范围 1–100，默认 25。调用源还支持 `thought_workshop_assistant`、
`visual_workshop_generation` 和 `audio_annotation`。

调用源 `model_diagnostic` 表示诊断 API 的固定 `OK` 快速诊断，`model_playground` 表示模型测试
工作台，`visual_workshop_assistant` 表示视觉工坊 Agent。详情按请求上下文、模型回复、Token 与
耗时分区展示，并支持可读/JSON、Markdown/原文切换。新产生的流式文本日志记录首 Token 耗时、
结束原因和模型轮次；旧日志没有对应观测值时返回原 payload 并显示为空。

复现包目前只对保存了完整纯文本消息的 OpenAI/Anthropic 调用开放。ZIP 包含脱敏后的
`request.json`、原日志响应快照、无第三方依赖的 `run_repro.py`、`.env.example` 和中文 README；
脚本支持单次调用、同步串行批量、异步限并发批量，并把逐次响应与成功率、min/mean/p50/p95/max
耗时写入本地结果目录。API Key 只能通过 `REPRO_API_KEY` 环境变量传入，也可用
`REPRO_BASE_URL` 覆盖当前供应商地址。带附件的文本调用以及实时语音、语音识别、图片和视频日志
因没有持久化原始输入而返回 `409 reproduction_unavailable`，不会生成不等价的复现包。

## 模型测试

- `GET/POST /v1/model-test/conversations`
- `GET/PATCH/DELETE /v1/model-test/conversations/{conversation_id}`
- `POST /v1/model-test/conversations/{conversation_id}/attachments`：multipart 批量上传待发送图片。
- `DELETE /v1/model-test/conversations/{conversation_id}/attachments/{attachment_id}`：删除未发送图片。
- `GET /v1/model-test/conversations/{conversation_id}/attachments/{attachment_id}/content`：鉴权预览图片。
- `POST /v1/model-test/conversations/{conversation_id}/messages/stream`
- `POST /v1/model-test/conversations/{conversation_id}/regenerate/stream`
- `GET/POST /v1/model-test/tools`：查询概览或创建当前 Workspace 的本地 Mock 测试工具。
- `GET/PATCH/DELETE /v1/model-test/tools/{tool_id}`：读取、CAS 更新或删除测试工具；已绑定会话的工具不可删除。
- `POST /v1/model-test/tools/{tool_id}/execute`：使用 JSON 参数执行一次确定性试运行并保存调用记录。
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
- `GET /v1/model-test/realtime-options`：返回已启用且声明 `voice` 能力的实时模型、15 个音色、默认音色、提示词/开场白长度限制、固定 PCM 协议，以及客户端 VAD、播放缓冲、麦克风处理和打断参数的默认值与数值范围；不返回密钥。
- `WS /v1/model-test/realtime`：Cookie Session 鉴权的实时语音双工连接；握手同时校验当前 Workspace 与精确 Origin。

实时 WebSocket 使用稳定的供应商无关 JSON 契约。客户端首条消息必须是
`start` 必须包含 `model_id`、`voice`、`instructions`，并可携带 `greeting`、
`client_vad {positive_speech_threshold, negative_speech_threshold, min_speech_ms,
pre_speech_pad_ms, commit_silence_ms}`、`playback {start_buffer_ms, recovery_buffer_ms}`、
`microphone {echo_cancellation, noise_suppression, auto_gain_control}` 和
`interruption_enabled`，以及最多 20 个当前 Workspace 已启用测试工具的 `tool_ids`。服务端读取工具
最新快照并转换为 SenseAudio Function Schema，客户端不能直接提交工具 Schema。客户端之后可发送
`audio`（Base64 PCM16/16 kHz）、
`commit_input`、`interrupt`、`mute` 和 `stop`。服务端只返回 `call_started`、用户说话与转写事件、
助手转写、`audio`（Base64 PCM16/24 kHz）、统一的 `tool_call_update`、`turn_done`、`interrupt`、
`error` 和 `call_ended`；`tool_call_update` 包含 `turn_id`、`call_id`、工具 ID/名称、参数、状态、
成功标记、结果或结构化错误及耗时。
其中 `user_transcript_delta.text` 是可被后续事件整体替换的实时识别假设，
`assistant_transcript_delta.text` 才是需要追加的文本片段。供应商原始事件不会透传。
未登录或 Session 失效以 4401 关闭，Origin 或 Workspace 校验失败以
4403 关闭。每个完成的助手回合复用同一 trace ID 写一条 `model_playground` 调用日志，只保存模型、
音色、输入/输出音频时长、转写字符数、首音频延迟、总耗时、usage 与状态。转写正文和双方 PCM 音频
只在当前浏览器页面进程内存在，按 `turn_id` 关联并可分别回放；切换模型测试页签或站内导航后仍可
返回查看。音频缓存总上限为 64 MiB；开始新通话、刷新或关闭页面、登出、切换 Workspace 后清除，
转写正文和音频都不进入数据库或日志。实时工具调用以 `source=realtime_voice` 使用独立短事务保存
完整工具快照、参数、结果、状态与耗时；调用日志只保存工具名称、状态与耗时摘要。

修改、删除、发送和重新生成使用会话 `expected_revision` 做 CAS 保护。发送请求可携带最多 5 个
`attachment_ids`，文本和图片至少提供一项。图片仅支持 JPEG、PNG、WebP 与静态 GIF，单张
最多 8 MiB、宽高最多 8000 像素；只有同时具有 `chat`、`vision` 能力的模型可处理图片。
图片随消息私有保存，成功轮次的历史图片会继续进入后续请求，重新生成复用原用户消息图片。
调用日志记录脱敏文本上下文、最终文本回复、会话 ID、首 Token、结束原因和轮次；图片仅记录 MIME
与大小，不记录图片内容或磁盘路径。流式接口返回 SSE v2 envelope，普通会话事件为 `start / delta /
done / error`；工具会话另有 `step` 事件，按 `proposed / running / completed / failed / cancelled`
更新工具步骤。成功、失败、超时或取消都会保存消息状态并写入调用日志。

测试工具名称在 Workspace 内唯一，只允许 1–64 位字母、数字和下划线；输入必须是合法的 Draft
2020-12 object JSON Schema，Schema 与成功返回分别不超过 64 KiB，延迟范围为 0–10,000 ms。
会话通过 `tool_ids` 按顺序绑定最多 20 个已启用工具；工具和会话更新都使用 revision/CAS。发送时读取
工具最新版并保存定义快照，历史调用不随工具修改而变化。选择工具后只允许同时声明 `chat` 与 `tools`
能力的 OpenAI/Anthropic 模型，Tool Choice 固定为 `auto`，最多运行 6 个模型轮次并容忍 3 次工具失败。
参数校验失败和配置的模拟失败都会作为工具结果交还模型；测试工具不访问网络，也不产生外部副作用。

模型测试页按能力与供应商协议自适应：只有声明 `chat` 的 OpenAI/Anthropic 模型进入多轮对话，
SenseAudio 图片/视频模型进入独立异步生成测试，声明 `voice` 的已启用模型进入实时语音测试。
实时语音使用与文本测试一致的纵向消息卡，工具卡嵌入对应助手消息并可展开参数、结果或失败原因；
支持免按键自动断句、双方实时转写、流式播放、麦克风/扬声器静音和说话打断。模型、音色、测试工具、
开场白、系统提示词、VAD、播放缓冲与麦克风处理参数在通话中锁定。SenseAudio 固定使用单声道
PCM16 little-endian，输入 16 kHz、输出 24 kHz；页面不允许提交供应商不支持的音频格式。页面按
`turn_id` 保留最近一次测试的多轮转写及双方语音；结束通话或离开实时语音页只关闭实时音频链路，
切换页面后仍可返回查看和回放。开始新通话、刷新或关闭页面、登出、切换 Workspace 后统一清除。
图片测试支持提示词、尺寸和种子；视频测试支持提示词、时长、分辨率、比例、
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

## 集成中心

- 工具 API：`GET/POST /v1/integrations/tool-apis`、`GET/PATCH/DELETE
/v1/integrations/tool-apis/{id}`、`POST .../{id}/validate`。
- MCP：`GET/POST /v1/integrations/mcp`、`GET/PATCH/DELETE /v1/integrations/mcp/{id}`、
  `POST .../{id}/validate` 与 `GET .../{id}/tools`。
- Skill：`GET/POST /v1/integrations/skills`、`GET/PATCH/DELETE /v1/integrations/skills/{id}`、
  `GET/POST .../{id}/versions` 与 `GET .../{id}/versions/{version}/content`。

列表和详情允许普通成员读取脱敏配置；创建、修改、删除和验证仅允许 Workspace Owner 或平台管理员。
修改、启停、删除、添加 Skill 版本和切换默认版本使用资源 `revision` 做 CAS，冲突返回服务器当前快照。
工具 API 验证只接受 HTTPS 或明确本机回环地址，支持 GET/POST/PUT/PATCH/DELETE、JSON Schema
输入与 `{{field}}` 模板；连接前重新解析主机，禁止凭证型 URL、重定向及私网/链路本地/多播地址，
超时为 30 秒且响应读取受限。本次脱敏预览不会落库。

MCP v1 支持 Streamable HTTP 与 stdio，不支持旧 SSE。HTTP 可选 Bearer；stdio 命令必须为白名单中的
绝对可执行文件，参数按数组传递且不使用 shell。验证建立短连接，发现 Server 信息和工具后立即关闭，
并覆盖当前工具快照。Skill 创建与加版使用 multipart ZIP；允许一个包装目录，但拒绝路径穿越、
绝对路径、符号链接、重复路径及超限包。每个版本在本地不可变，包内脚本不会执行。

Skill 列表和详情返回 `tags: string[]`。创建时用 multipart 重复字段 `tags` 传入标签，
省略默认为空；PATCH 可传 `tags`，省略保留现值，`[]` 清空，`null` 或非数组返回 422。
最多 12 个标签，去首尾空白、空项和重复值。标签与启停、默认版本共用 `expected_revision`
进行 CAS；仅修改标签不新增内容版本，追加版本和切换默认版本不覆盖标签。
`integration_skills.tags` 为非空 JSON 数组，迁移 `0047_skill_tags` 将旧条目初始化为 `[]`。
标签仅属于当前 Workspace，文件路径显式从已鉴权 Workspace 派生。

集成中心 v1 只管理与验证资源，不会把工具 API、MCP 或 Skill 注入 Agent Harness，也不会导入
OpenAPI 或执行定时健康检查。

## 录音分段标注

- `GET/POST /v1/audio-annotation/projects`：搜索或创建当前 Workspace 的录音标注任务。
- `GET/PATCH/DELETE /v1/audio-annotation/projects/{project_id}`：读取、重命名或删除任务。
- `GET/PUT /v1/audio-annotation/projects/{project_id}/document`：读取或完整保存说话人和片段文档。
- `GET/PUT /v1/audio-annotation/projects/{project_id}/waveform`：读取或保存浏览器生成的预计算峰值。
- `POST /v1/audio-annotation/imports`：把版本化项目 JSON 与选定的文件库音频原子导入为新任务。
- `POST /v1/audio-annotation/transcription-imports`：从已完成的模型测试识别任务直接创建标注任务，
  或把 `future-props-transcription` 1.0/1.1 JSON 与选定音频转换为新任务。
- `POST /v1/audio-annotation/projects/{project_id}/segment-transcriptions`：接收浏览器从当前片段
  裁剪出的单声道 PCM WAV，使用指定的已启用语音识别模型返回一次性文本。请求可同时携带原文语言
  和目标语言标签；服务端按模型支持项匹配完整标签、主语言或供应商别名。编辑原文页签时只按原文
  语言转写，无法匹配时才回退为自动识别；编辑本地化页签时按原文语言识别并返回目标语言译文。
  模型不支持目标语言时返回 `409 target_language_unsupported`，供应商未返回完整译文时请求失败，
  不会把原文误写到目标语言版本。该接口不直接修改标注文档，也不创建模型测试任务，调用结果通过
  `audio_annotation` 来源写入模型调用日志。

创建和导入只接受当前 Workspace 公共文件库中的音频，单文件最多 100 MiB、时长最多 60 分钟；
音频时长由服务端读取。文档固定使用 `schema_version: "1.0"`，最多 64 位说话人和 5000 个片段。
片段最短 100 毫秒，允许留空白和时间重叠，但必须按开始时间排序，说话人引用必须存在。
每个片段可通过 `speaker_ids` 按顺序关联多位说话人；`speaker_id` 保留为第一位主说话人并兼容
旧文档，省略 `speaker_ids` 时会自动从 `speaker_id` 补齐。每个片段的 `text` 可通过 `language`
指定原文语言，并用
`localized_texts` 保存最多 32 份其他语言文本；同一片段内语言不得重复，未提供时兼容旧文档。
每个片段还可使用 `emotion` 保存最多 40 个字符的预设或自定义情绪；未标注时为 `null`，旧文档
省略该字段时仍可直接读取和导入。
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
- `GET /v1/visual-workshop/projects/{project_id}/snapshot` 与 `POST /v1/visual-workshop/projects/snapshot-imports`：下载可移植 ZIP，或上传 `file` 并创建全新副本。
- `POST /v1/visual-workshop/projects/{project_id}/open-folder`：在运行 Studio 的电脑上打开服务端推导的项目目录。
- `GET/PUT /v1/visual-workshop/projects/{project_id}/canvas`：读取或以 CAS 保存完整节点与连线画布。
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
素材/生成任务引用与世界坐标，并使用独立于项目元数据的 `revision`。画布的 `edges` 保存动态节点
引用并拒绝自连、重复边、类型不兼容和依赖环；删除节点时同时清理关联边。图片、视频和音频节点均可携带
`generation_draft`，分别保存节点级提示词、模型、生成参数与参考素材选择；草稿允许尚未满足生成
条件，但仍校验字段范围、素材数量、媒体类型和项目归属。图片和视频草稿的
`prompt_reference_names` 保存素材 ID 到“画布节点标题 + 真实后缀”的局部提示词别名；它不修改
文件库名称，旧草稿缺少该字段时按空映射处理。`PUT` 必须携带
`expected_revision`；冲突返回服务器画布快照，Web 不会静默覆盖。媒体节点创建生成任务后
保存任务 ID，任务完成时把结果素材回填到原节点，同时保留原生成草稿。Web 对草稿文字使用画布
自动保存，对素材和离散参数立即保存，并在创建生成任务前等待画布保存完成。上传文件本身立即进入
项目素材库，取消草稿选择不会删除文件。视口缩放和平移仍属于浏览器本地偏好。

连线不复制素材 ID。创建下游生成任务时，后端按提交的画布 revision 解析上游节点当前素材，再与
手工参考素材合并、去重并执行项目/Workspace 校验；上游改名或替换素材无需重建连线。图片节点只
接收图片，视频节点接收图片、视频和音频，音乐节点只接收音频，音效模式拒绝入边；上游没有素材时
返回 `409 upstream_asset_pending`。任务的 `request_payload.reference_filenames` 由服务端按提交时
的上游节点标题派生并保存快照，客户端不能覆盖；视频和音频参考素材临时上传时使用该名称及素材
真实后缀，旧任务没有映射时继续使用随机文件名。

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
- `GET /v1/galgame-workshop/projects/{project_id}/snapshot` 与 `POST /v1/galgame-workshop/projects/snapshot-imports`：导出或导入为全新 Galgame 工程副本。
- `POST /v1/galgame-workshop/projects/{project_id}/open-folder`：在运行 Studio 的电脑上打开项目目录。
- `GET/PUT /v1/galgame-workshop/projects/{project_id}/story`：读取或整份 CAS 保存 Story 1.4 故事文档。
- `PATCH /v1/galgame-workshop/projects/{project_id}/story/dialogue`：以 Story revision CAS 快速保存单条对白的文本、表情与立绘演出，不重传整份文档或重建素材引用。
- `PATCH /v1/galgame-workshop/projects/{project_id}/story/stage-expression`：以 Story revision CAS 快速保存 `showCharacter` 或 `setStageCast` 中一个舞台角色的表情，不重传整份故事。
- `PATCH /v1/galgame-workshop/projects/{project_id}/story/edits`：以 `expected_revision` 和 1–1000 项判别联合 `edits` 原子保存多条对白与舞台表情；全部校验通过后只提交一次并递增一次 Story revision，重复目标或任一无效目标返回 422 且零写入，revision 冲突返回 409 与当前故事快照。
- `GET /v1/galgame-workshop/story-migrations/status`：统计当前 Workspace 中待迁移、无效和当前格式的 Story 数量。
- `POST /v1/galgame-workshop/story-migrations/run`：按 `limit`（1–100）幂等迁移一批 Story 1.0–1.3，并报告 CAS 冲突和剩余数量。
- `POST /v1/galgame-workshop/projects/{project_id}/story/import`：以 multipart `expectedRevision` 和 `file` 导入不超过 10 MiB 的 Story 1.0–1.3 JSON，一次性转换为 1.4。
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
- `POST /v1/galgame-workshop/projects/{project_id}/annotation-imports/preview`：只读核对广播剧标注、完整主音轨、说话人映射、Story 占位素材、对白时间/中文和演出数量。
- `POST /v1/galgame-workshop/projects/{project_id}/annotation-imports`：以 `requestId` 幂等创建持久化导入任务；服务端从完整源音频裁切逐句配音、保存 Story 快照并执行 CAS 更新。
- `GET /v1/galgame-workshop/projects/{project_id}/annotation-imports/{import_id}`：读取导入进度、音频内容校验、保存验收或自动回滚结果；`phase` 明确返回 `queued`、`cutting`、`validating`、`saving`、`accepting`、`rolling_back` 等阶段。
- `POST /v1/galgame-workshop/projects/{project_id}/video-exports/preview`：按 Story revision、语言、四档输出规格、取景框和已有分支选择推演路线；逐次返回下一处待选分支、预计时长、结局、阻断问题与含素材指纹的预览指纹。
- `POST /v1/galgame-workshop/projects/{project_id}/video-exports/frame`：使用与正式导出相同的冻结路线和 `RenderPlan` 返回指定时间点的精确 PNG 帧。
- `POST /v1/galgame-workshop/projects/{project_id}/video-exports`：以 `requestId` 和预览指纹幂等创建后台 MP4 导出任务并保存只读 Story 快照；正式合成不启动浏览器或 JavaScript 时钟。
- `GET /v1/galgame-workshop/projects/{project_id}/video-exports` 与 `GET .../{export_id}`：读取导出历史、阶段、进度、已渲染时间和结果素材。
- `POST /v1/galgame-workshop/projects/{project_id}/video-exports/{export_id}/cancel`：取消排队或运行中的任务；运行中会终止隔离渲染与编码进程并清理临时文件。
- `GET /v1/galgame-workshop/projects/{project_id}/video-exports/{export_id}/download`：下载完成的 H.264/AAC MP4。
- `POST/GET /v1/galgame-workshop/projects/{project_id}/video-editor-handoffs`：以相同预览指纹创建或列出后台剪辑交接任务；每次完成都会产生新的冻结、分层视频剪辑工程并物理复制依赖素材。
- `GET /v1/galgame-workshop/projects/{project_id}/video-editor-handoffs/{task_id}` 与 `POST .../{task_id}/cancel`：读取交接进度、输出剪辑工程与轨道/素材摘要，或取消任务并清理尚未完成的工程。

### 视频剪辑工坊

- `GET/POST /v1/video-editor/projects` 与 `GET/PATCH/DELETE /v1/video-editor/projects/{project_id}`：管理 Workspace 隔离的剪辑项目；修改和删除使用 revision CAS。
- `GET /v1/video-editor/projects/{project_id}/snapshot` 与 `POST /v1/video-editor/projects/snapshot-imports`：导出或导入为全新剪辑项目副本。
- `POST /v1/video-editor/projects/{project_id}/open-folder`：在运行 Studio 的电脑上打开项目目录。
- `GET /v1/video-editor/import-sources`：列出当前 Workspace 可复制到剪辑项目的文件库、视觉工坊与 Galgame 素材。
- `GET/POST /v1/video-editor/projects/{project_id}/assets`：读取或上传项目素材；`POST .../assets/import` 将源文件物理复制为项目快照。
- `POST /v1/video-editor/projects/{project_id}/assets/{asset_id}/proxy/retry`：重试 FFprobe、540p 代理、缩略图和波形生成。
- `GET /v1/video-editor/projects/{project_id}/timeline`：读取微秒级 16:9 多轨时间轴。
- `POST /v1/video-editor/projects/{project_id}/timeline/operations`：以 `expectedRevision`、`requestId` 原子提交视觉、音频和混合轨道、Clip、链接、`separateClip` 分离、转场、关键帧和 `setAssetOrganization` 素材文件夹编排操作；批次只增加一次 revision，同一 requestId 幂等。`assetOrganization` 保存一级文件夹、未分类素材及各自顺序，并随工程快照复制和重映射素材 ID。
- 混合轨支持视频与图片 Clip，图片可直接接在视频前后并使用相同的接缝吸附；新插入静态图片默认展示 5 秒，可调整时长。图片可在视觉轨和混合轨之间移动，不创建音频片段，也不参与原声音轨混音；同轨不允许重叠。混合轨视频仍需通过 `separateClip` 分离后移入视觉轨，音频、文字和纯色片段仍使用各自原有轨道类型。
- 时间轴片段支持左右边缘拖动与键盘方向键逐帧调整（Shift 为十帧），关联片段同步裁剪。静态图片可延长展示，视频和音频受素材源区间限制；同轨邻接片段、时间轴零点与至少一帧时长限制会约束拖动。`trimClip` 拒绝锁定轨道，保留区间内关键帧随左边缘调整相对时间，移除区间外关键帧并缩短超出片段的转场；撤销使用 `restoreClipStates` 恢复完整状态。
- 视频/音频素材后台处理会在预览转码前单独保存探测结果。`processingStatus=processing` 且 `probe.durationUs` 为有效正数时，Web 已允许拖入和剪辑；`proxyUrl` 仍为空时显示“预览准备中”，准备完成后自动使用预览文件。未读取到时长和失败素材不会被加入时间轴，拖放会提示原因。
- 视频/音频 Clip 的 `playbackRate` 范围为 0.25～4，省略为 1。`setClipSpeed` 操作接收 `clipId`、`playbackRate` 和可选 `ripple`（默认 `false`，兼容旧客户端），同步修改同一链接组的媒体片段：保持起点、源起点及源范围，按旧速度/新速度调整时长（向下取整到微秒）、关键帧和转场。`ripple=true` 时，按变速前所选片段的结束时间，将同轨起点不早于该结束时间的后续片段及其链接组成员整体移动新旧时长差，每个片段只移动一次，保留间隔；变速媒体本身保持起点，其他无关联轨道不受影响。锁定轨道、负起点或非法重叠使整个批次失败。Web 默认开启“后续片段跟随”，允许关闭并按项目记住选择。`restoreClipStates` 接收非空且 ID 唯一的 `clips` 完整状态列表，在单个操作内恢复现有片段，用于一次撤销整个变速与跟随移动；不允许创建片段或改变所属轨道，仍执行 Workspace 权限、revision CAS、轨道锁定、素材归属和最终时间轴校验。撤销与重做不会因后续片段超过 200 个而拆成多个批次。源时间为 `sourceInUs + floor(localUs * playbackRate)`，分割、预览、精确帧、完整导出与分段导入遵循相同映射，音频变速保持音调。r0043 在现有时间轴 JSON 补齐默认速度；旧任务快照/导入文档仍按 1×读取，无需重写不可变快照。
- `POST/GET /v1/video-editor/projects/{project_id}/segment-exports`：按不可变时间轴快照幂等创建或列出分段导入任务；每段单独保存名称、源范围、分辨率、帧率、质量和音频策略。
- `GET /v1/video-editor/projects/{project_id}/segment-exports/{task_id}` 与 `POST .../{task_id}/cancel`：读取逐段进度、最终素材/节点映射或取消任务。
- `GET /v1/video-editor/projects/{project_id}/preview/frame`：按 revision、`timeUs` 和宽度返回服务端精确 PNG 帧。
- `POST /v1/video-editor/projects/{project_id}/renders/preflight`：检查素材就绪、范围和画面空档，并返回包含时间轴、素材指纹和输出规格的 fingerprint。
- `POST/GET /v1/video-editor/projects/{project_id}/renders`：从不可变时间轴快照创建或列出后台 H.264/AAC MP4 渲染任务；正式渲染不会启动浏览器录屏。
- `GET /v1/video-editor/projects/{project_id}/renders/{task_id}` 与 `POST .../{task_id}/cancel`：读取进度、失败原因、输出素材或取消完整 FFmpeg 进程树。
- `DELETE /v1/video-editor/projects/{project_id}/renders/{task_id}?expected_revision=N`：删除已完成、失败或已取消的成片任务，并清理对应导出视频及代理、缩略图和波形；保留剪辑工程和源素材。需要 `content.write` 权限，跨 Workspace 或非成片任务返回 404，缺少 revision 返回 422，版本冲突和进行中的任务返回 409。成片仍被时间轴或进行中的任务引用时返回 422 `asset_in_use`，任务和文件均保留。

三种快照共用版本化清单，只包含当前可编辑文档及其依赖素材；不包含对话、任务历史、代理、缩略图、波形、缓存或未被当前工程使用的历史输出。导入在隔离目录校验路径、声明文件、展开大小、文件数、实际大小和 SHA-256，然后重建项目、素材和引用 ID。共享文件会成为副本的私有素材；无法在目标 Workspace 匹配的模型绑定会清空并通过 `{code, field, message}` 警告返回。打开文件夹只允许具有写权限的浏览器 Session；Management API Key 始终返回 `403`，且请求不接受客户端路径。

时间轴的 `splitClip` 会在同一帧原子分割覆盖播放头且共享 `linkGroupId` 的画面与原声音轨，左半段
保留原链接组，右半段使用新的链接组。分段导入只编码视频 Clip 的源区间，不合成字幕、转场或其他
轨道叠层；输出统一为 H.264/yuv420p MP4，保留音频时使用 AAC。全部分段编码成功后才在目标视觉
项目中一次性创建素材引用和横向独立视频节点，失败或取消不保留半批数据。

### 分段导出与可选画布导入

分段任务创建请求的 `target` 必须显式提供；`null` 表示仅导出，已有目标对象继续使用
`{projectId}` 或 `{newProjectTitle}`。服务端仅编码 `segments` 中的片段（1–100 个，不允许重复 Clip），
保存提交时的时间轴快照和各段参数；`expectedRevision` 冲突返回 409，缺失返回 422。
任务创建仍按 `requestId` 幂等，同一 ID 不得重用于不同请求。

结果详情增加 `importRequested`，纯导出时 `targetProjectId` 为 null，各段完成后提供
`assetId`、`outputFilename` 和 `spec`，`nodeId` 为 null；导入模式继续返回素材/节点映射。
历史任务缺少模式字段时按原导入模式展示，不改写历史快照。纯导出文件归属源剪辑项目，
未被编辑文档使用的输出不进入项目快照。

- `GET /v1/files/{asset_id}/download`：沿用鉴权文件下载，获取单段 MP4。
- `GET /v1/video-editor/projects/{project_id}/segment-exports/{task_id}/download`：
  获取完成任务的全部片段 ZIP，文件按请求顺序加三位序号并清理非法文件名字符。
  未完成返回 409；任务、输出素材或文件缺失返回 404，不返回缺段 ZIP。
  校验 Workspace 与任务归属，打包使用临时文件并在响应结束后清理。

任务列表同时呈现完整渲染与分段导出，支持关闭导出弹窗后的进度查询和文件下载。

项目素材响应的 `transcriptSegments[]` 与转写任务的 `resultSegments[]` 使用统一的
`{ speaker, startMs, endMs, text }` 形状。SenseAudio ASR Pro 请求启用说话人分离、自动标点和
句级时间戳；音频按所选模型的 10 MB 或 100 MB 上限校验，超限时不会提交供应商。手工修正整段文本会清空旧分段，
避免结构化结果与新文本不一致；检测得到的 `speaker_*` 仅用于展示，不自动绑定剧本角色。

广播剧导入请求中的 `document.assets` 使用标注 `segmentId` 作为待生成 `voiceLine.fileId`
占位，服务端只在时间、中文、说话人和一一绑定均与标注文档一致时接受。完整源音频必须作为
`timelineMaster` 直接引用，任务执行器使用采样时间裁切并核对编码时长和内容包络；最终 Story
只由主音轨推进，逐句音频保留为检查器试听与审计素材。自动化客户端应使用绑定单一 Workspace
且含 `studio:write` 的 Management API Key；`npm run galgame:import-annotation -- ...` 不读取
浏览器 Cookie，也不直接访问数据库。
极少数源片段未设置说话人时可通过 `segmentSpeakerOverrides` 显式补充；已有说话人标注的片段
禁止覆盖，所有补充都会保存在任务请求和审计结果中。`masterAssetId` 可指向目标工程中已有的
完整音频副本，但其时长和 SHA-256 必须与标注项目的源音频完全一致。

视频导出支持三种范围：`scope: route` 按分支选择推演至结局；`scope: fragments` 通过
`fragmentIds` 单选或多选 Fragment，并按请求顺序合并为一个 MP4；`scope: clip` 通过
`clipRange: { fragmentId, startMs, endMs }` 只渲染单个时间轴 Fragment 的指定区间。快速试片区间
必须位于 Fragment 时间轴内、结束晚于开始且最长 5 分钟；区间与 Story revision 一起进入预览指纹
和任务快照。片段模式不会跟随片段中的分支、调用或章节跳转进入未选择内容。三种范围均支持
`720p30`、`1080p30`、`720p60` 与 `1080p60` 四档预设。
三种范围都可提交 `captureFrame: { x, y, width, height }`。该坐标固定以 1920×1080 舞台为基准，
四个值均为偶数整数，最小尺寸 320×180，必须严格保持 16:9 且完整位于画布内；字段缺失时按
`{ x: 0, y: 0, width: 1920, height: 1080 }` 兼容全画面。取景框参与预览指纹、任务请求和渲染
manifest；确定性渲染器先按 1920×1080 规范舞台裁剪，再用 Lanczos 缩放回输出规格。
后台使用任务创建时的 Story 快照，不访问网页、Chromium、Playwright 或 JavaScript 时钟，也不
读取用户浏览器 Cookie或改写 Story revision。分支固定显示
2 秒，并在最后 0.5 秒高亮预选项；时间轴按 `durationMs`，普通剧情按播放器自动推进规则执行。
快速试片会从 Fragment 起点归约舞台状态，并按绝对时间恢复片段起点处的角色、动画和对白；输出
只在最终合成阶段归零。主音轨按区间起点设置素材偏移且只混入一次，存在主音轨时不再叠加逐句
配音；普通 Story 会按实际播放事件混合逐句配音、BGM、环境音、
音效及视频声音。成片验证通过后登记到项目 `exports/`，预览失效、路线循环、素材缺失、磁盘不足
或媒体参数不符都会阻止创建或把任务标记为失败。

序列帧立绘不会在导出时压成代表首帧：`timed` 序列按表情启用的 Story 绝对时间播放，`lipSync`
三帧序列由主音轨或逐句配音的离线 RMS 包络确定闭口、半口和张口状态。快速试片会从 Fragment
起点预热口型底噪，任务的 `analyzing` 阶段负责生成或读取素材指纹缓存。人物动作、镜头与全舞台
动画在同一绝对时间变换中组合，精确 PNG、直接 MP4 和剪辑工坊交接共用该结果。

- `GET/POST /v1/galgame-workshop/projects/{project_id}/story/portrait-upgrade`：预览或应用旧立绘尺寸升级；应用前自动保存快照。
- `GET /v1/galgame-workshop/projects/{project_id}/story/snapshots` 与 `POST .../{snapshot_id}/restore`：列出并以 Story revision 恢复维护快照。
- `DELETE /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}`：按素材 revision 删除未被故事使用的工程素材；引用冲突返回可定位的角色、Fragment 与 Block 信息。

工程状态为 `draft / completed`，标题长度为 1–120 字。修改和删除必须携带工程的
`expected_revision`；冲突返回 `409 revision_conflict` 以及服务器当前工程快照。新建工程会同时
写入 `schemaVersion: "1.4"` 故事文档，预置 `chapter-1` 章节和入口为 `main` 的空 Fragment。
故事包含 `synopsis`、`entryChapterId`、类型化变量、角色属性模板、角色、场景、剧情 CG、项目级
`settings` 及
`chapters → fragments → blocks`。章节有稳定 ID、顺序、入口 Fragment 和禁用状态；入口章不能删除或禁用，
`endChapter` 会进入下一启用章。迁移阶段 A 仍兼容读取 `schemaVersion: "1.0"` 至 `"1.3"`，但主
Story 真源应通过 Workspace 迁移 API 固化为 `schemaVersion: "1.4"`；外部旧文件只通过专用导入
接口转换。批量迁移和导入均继续使用整份文档 revision CAS，不会静默覆盖并发编辑。完成备份、停止
编辑且迁移状态达到 `pending=0`、`invalid=0` 前，不得移除旧格式读取兼容。完整流程见
[`Story 迁移运维`](../operations/story-migrations.md)。`settings.canvas` 保存 640×360 至
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
`setStageCast` 会原子替换当前舞台构图，`members` 可为空并最多保存三名互不重复的角色；每名成员独立保存
表情、皮肤、位置、远中近景、精细缩放、亮度、层级和进场效果，未保留角色统一使用 `exitTransition` 退场。
位置预设继续决定 `x / y / anchor`，显式 `transform.scale` 作为当前演出的精细距离保留；缺少显式缩放时才
回退角色资产基准尺寸。故事保存使用独立
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
视频、原子舞台构图、精灵动画、自动播放、对话框样式、立绘发言规则、鉴赏、条件、变量赋值、调用 Fragment 和返回入口章。
扩展方法、扩展界面与任意自定义运行时 Block 不在该联合类型中。条件表达式只允许读取已声明变量与角色属性，
不会执行 JavaScript。

`camera.target` 的 `stage / background / characters / cg` 在播放器中分别作用于全部视觉层、背景、角色或
剧情 CG，对话框、选项和自定义 UI 不参与镜头变换；背景图层按 `distance` 产生视差。`animateSprite` 保留
自由字符串兼容，并为 `breathe / nod / shake / startle / lean / recoil / step / tug / bounce` 提供标准动作，
可配置方向、强度、缓动、时长和循环；每次 Block 触发都有独立标识，因此连续使用相同动作仍会重新播放。

`cgs[]` 独立维护剧情 CG，不作为场景背景差分使用。每项 CG 最多包含 100 个 `variants[]`，图片必须引用
`storyCg` 素材；存在差分时必须设置有效的 `defaultVariantId`。`showCg` Block 显式显示或替换 CG，
`variantId: null` 跟随默认差分。`displayMode: fullscreen` 保持传统全屏 CG，`fit` 支持铺满裁切的
`cover` 和黑边完整显示的 `contain`；`displayMode: overlay` 在场景上等比叠加图片，`overlay` 保存中心点
百分比坐标、舞台宽度百分比、透明度以及角色前方/后方两档位置。`hideCg` 显式隐藏当前 CG，没有活动 CG
时是确定性空操作。全屏 CG 和前景叠加 CG 覆盖角色，后景叠加 CG 位于背景与角色之间；自定义 UI、对话框、
选项和系统交互继续显示在其上方。切换场景和分支跳转不会隐式隐藏 CG，章节结束和重新试玩会清空。旧 V1
故事缺少 `displayMode` 时按 `fullscreen` 读取，缺少叠加参数时使用居中、60% 宽度、完全不透明和角色前方；缺少
`cgs` 时读取为 `[]`，保存后统一写为当前的 `schemaVersion: "1.4"`。

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

`presentation.dialogueBox` 保存工坊内置试玩的全局对话框外观。除预设、底色、正文与角色名颜色、
透明度、圆角和旧版 `fontScale` 外，还可分别配置面板布局、纵向渐变、顶部边线、正文安全边距与对齐、
人物名位置与装饰线，以及推进状态的位置、样式和视频导出可见性。内置 `classicGradient` 是全宽底部渐隐
样式；编辑器预览、正式试玩和视频导出共用同一套样式解析结果，`switchDialogueStyle` 也会切换完整预设。
视频导出把解析后的对话框、富文本、人物名和推进指示器预渲染为透明 RGBA 图层，并使用应用内固定
版本的 Noto Sans CJK SC 字体；字体不可读时预检/编译失败，不回退到缺少中文字形的位图字体。
可选 `assetId` 必须引用 `assets[]` 中 role 为 `dialogueBox` 的静态图片；上传图片与角色立绘、场景背景
复用同一套工程私有素材和全局文件引用生命周期。旧 V1 故事缺少新增字段时沿用原暗色面板视觉，首次
修改后随 Story CAS 整体保存。
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
`voiceSample / voiceLine / timelineMaster / backgroundMusic / ambientSound / soundEffect` 角色。角色可通过
`voiceProfile` 保存声线名称、语言、描述和试听样本；对白通过 `voiceAssetId` 与 `voiceVolume`
绑定逐句配音。`audio` Block 显式控制 `bgm / ambient / sfx` 通道的播放、停止、音量、循环和
淡入淡出；BGM 与环境音不会从场景隐式继承。Fragment 可选
`timeline: { durationMs, masterAudio?: { assetId, volume } }`，其中
`durationMs` 是独立的剧情总长。对白、旁白、剧情段落或系统消息通过成对的 `startMs / endMs` 绑定剧情时间轴；`scene`、`showCharacter`、`setStageCast`、
`removeCharacter`、`showCg`、`hideCg` 与 `audio` Block 可用 `atMs` 固定触发点。无时间轴的 Fragment 拒绝这些时间字段；
有时间轴时所有显式时间都不能超过剧情总长，对白/旁白还必须有序且互不重叠。
`masterAudio` 只能引用 `timelineMaster` 音频；配置后完整音频的播放位置成为剧情唯一时钟，加载、暂停、继续、拖动和结束
均由它驱动，逐句 `voiceLine` 仍可绑定和单独试听，但试玩不会重复播放。线路报告要求主音轨文件存在，且媒体时长与
`durationMs` 相差不超过 1ms。未配置主音轨的旧 Story 保持原逐句配音和独立剧情时钟行为。

编辑器把一次 `showCg` 到下一个 `showCg`、`hideCg` 或时间轴末尾派生为可拖动、可调整双端的 CG 显示区间。
调整没有显式结束事件的区间时会补充 `hideCg`；相邻 CG 的替换时间是共享边界，区间最短 100ms。

同一时刻允许一个场景状态、一个 CG 事件、多个不同角色和多个 SFX；BGM 与环境音各自只允许一条播放事件，但允许
先停止再播放以交叉淡化。同一时刻的归约顺序固定为：场景切换、角色退场、角色登场/调整、CG
显示/隐藏、持续声音停止、持续声音播放、SFX、对白/旁白，同类事件保持原 Block 顺序。缺少 `atMs` 的
`showCharacter / setStageCast / removeCharacter` 跟随 Block 顺序中的下一句对白；没有后续对白时跟随剧情结尾。移动对白时这些
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

## 图片、视频与音频生成

- `GET /v1/visual-workshop/generation-options`：返回已启用的 SenseAudio 图片、视频、音乐与音效模型及图片尺寸。
- `POST /v1/visual-workshop/projects/{project_id}/generation-tasks`：创建图片、视频或音频生成任务。
- `POST /v1/visual-workshop/projects/{project_id}/generation-batches`：创建 4 宫格或 9 宫格图片批次，可选择独立节点或后台合成大图。
- `POST /v1/visual-workshop/projects/{project_id}/image-compositions`：将当前项目中恰好 4 或 9 个已有图片节点按指定顺序、caption 和画布 CAS 参数创建为合成批次。
- `GET /v1/visual-workshop/generation-tasks`：按项目、画布节点、类型、状态分页筛选任务；节点筛选用于读取图片、视频或音频节点的生成历史。
- `GET /v1/visual-workshop/generation-tasks/{task_id}`：读取单个任务。
- `GET /v1/visual-workshop/generation-batches` 与 `GET /v1/visual-workshop/generation-batches/{batch_id}`：读取宫格批次进度、成功/失败数量及合成素材。
- `POST /v1/visual-workshop/generation-batches/{batch_id}/retry-composition`：重新执行失败的已有节点合成批次。
- `POST /v1/visual-workshop/generation-tasks/{task_id}/retry-materialization`：只重试已生成结果的本地保存。

任务状态统一为 `queued / submitting / pending / processing / completed / failed`。本机执行器每
5 秒恢复和轮询任务，最多并发 4 个远端请求；只有结果通过 HTTPS 公网地址、重定向、文件大小、
MIME 与文件签名校验并原子写入项目素材后才进入 `completed`。远端失败需要新建任务，只有响应中
`can_retry_materialization=true` 的失败任务才能安全重试本地保存。任务与日志不保存 API Key、
Data URI 或素材内容。

`submitting` 表示本机已认领、但尚未持久化供应商任务编号。应用若在此阶段中断，恢复时会直接结算为
`failed` 并提示重新生成，不会自动再次提交，以避免重复计费。`pending/processing` 会从已保存的
供应商任务编号继续轮询；已保存 `result_url` 的 `processing` 任务只恢复本地下载和素材结算。

图片任务可携带一张项目图片作为参考。视频界面提供文生视频、图生视频、首尾帧和全能参考；API
以纯文本、首尾帧或参考素材三种互斥模式表达，其中图生视频使用只有首帧的首尾帧模式。时长
4–15 秒，参考模式最多 9 张项目图片、3 个音频素材 ID 和 3 个视频素材 ID，且不能仅提供音频。
图片以 Data URI 发送；音频和视频由后端临时托管后再提交，临时 URL 不进入任务快照或日志。
执行器仍兼容升级前已排队任务中的旧 URL 字段。视觉模型不进入模型服务页的固定 `OK` 快速诊断，
但可在模型测试页执行真实生成测试。音乐任务通过 Music 2.0 异步接口生成纯音乐/BGM，可接收项目
音频参考；音效通过同步接口固定生成一个变体且不接收入边。音频结果与视觉结果共用安全下载流程，
按文件头与 MIME 双重识别 MP3、WAV、M4A 和 OGG 后原子落盘；确定性测试不调用真实供应商。

## 文件管理与项目素材

- `GET/POST /v1/file-folders`：读取或创建文件管理/项目素材文件夹。
- `PATCH/DELETE /v1/file-folders/{folder_id}`：CAS 改名、移动或递归删除文件夹。
- `GET/POST /v1/files`：按项目、当前文件夹、搜索词、媒体类型和排序查询，或 multipart 上传单文件。
- `PATCH/DELETE /v1/files/{asset_id}`：CAS 改名、移动或删除文件。
- `GET /v1/files/{asset_id}/content`、`/download`：鉴权预览或下载原始内容；下载接口可传
  `download_name` 作为本次下载的显示名，服务端始终追加素材自身的真实后缀并清理路径字符。
- `POST /v1/visual-workshop/projects/{project_id}/asset-imports`：批量导入公共库引用，或把其他视觉项目素材复制为当前项目的独立副本。

不带 `project_id` 的文件和文件夹属于 Studio 一级“文件管理”；带 `project_id` 的内容属于项目
私有素材。项目导入公共文件时只建立引用，不复制磁盘内容；存在项目引用的公共文件或包含它的
文件夹返回 `409 asset_in_use`，必须先从相关项目移除引用。跨项目导入会复制文件和素材元数据，
因此来源素材或来源项目后续删除不会影响目标项目。批量复制任一项失败时不会保留部分结果或临时文件。
文件夹最多五层。

允许 JPEG、PNG、WebP、GIF、AVIF、MP4、WebM、MOV、MP3、WAV、M4A、OGG、PDF、TXT、
Markdown、JSON、Word（doc/docx）、Excel（xls/xlsx）、PPT（ppt/pptx）、CSV 与 ZIP；服务端同时校验扩展名、MIME、文件头和配置的大小上限。现代 Office 校验 ZIP 内对应文档结构，旧 Office 校验复合文档签名；文本检查 UTF-8，JSON 执行完整语法解析。ZIP 保存原文件，不自动展开。
文件使用随机存储键保存，
原始文件名不参与磁盘路径构造。

## 健康与鉴权

- `GET /health`
- `GET /ready`

健康探针保持匿名；所有 `/v1` 业务接口按本页“账号与 Workspace”规则鉴权。
`/ready` 成功响应继续返回 `status` 与当前 schema；数据库不可用、Runner 未启动或退出、或任一
Runner 连续失败达到 3 次时返回 503。单轮 Runner 异常会被记录并按有上限指数退避重试，成功一轮后
清零连续失败计数。

## 思绪工坊

所有接口位于 `/v1/thought-workshop`，使用现有 Studio Cookie/CSRF 或 Management API Key，
Workspace 仅从认证主体派生。跨空间 ID 返回 404。

| 接口                                   | 行为                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST /knowledge-bases`            | 查询（query、trash）／创建知识库，自动创建空白首页                                                                                      |
| `GET/PUT /knowledge-bases/{id}`        | 读取／带 expected_revision 修改名称、简介、cover_asset_id                                                                               |
| `DELETE /knowledge-bases/{id}`         | 带 expected_revision 整库移入回收站                                                                                                     |
| `POST /knowledge-bases/{id}/restore`   | 带 expected_revision 恢复，保留原文档回收站状态                                                                                         |
| `GET /knowledge-bases/{id}/directory`  | 库快照与未删除普通文档（含 parent_id 嵌套树）                                                                                           |
| `POST /knowledge-bases/{id}/documents` | expected_revision、title、parent_id 创建空文档                                                                                          |
| `POST /knowledge-bases/{id}/move`      | expected_revision、item_id、parent_id、before_id；库内移动与排序                                                                        |
| `GET /notes`                           | 必填 knowledge_base_id；query、parent_id（unfiled 为根目录）、tag、view、sort、offset、limit；普通文档摘要不含正文和首页                |
| `POST /notes`                          | knowledge_base_id、parent_id、expected_knowledge_revision 与 v2 正文，原子创建文档                                                      |
| `GET/PUT /notes/{id}`                  | 读取／带 expected_revision 保存完整文档和元数据                                                                                         |
| `DELETE /notes/{id}`                   | 带 expected_revision 与 expected_knowledge_revision 移入回收站；cascade_children=true 连同子树；permanent=true 永久删除回收站笔记       |
| `POST /notes/{id}/restore`             | 带 expected_revision 与 expected_knowledge_revision 恢复                                                                                |
| `POST /images`                         | multipart upload 上传公共图片，返回 asset_id                                                                                            |
| `POST /attachments`                    | multipart upload 上传公共附件，返回 asset_id、filename、mime_type、byte_size                                                            |
| `GET /models`                          | 当前空间可用的写作模型                                                                                                                  |
| `POST /notes/{id}/assistant`           | model_id、expected_revision、action、instruction、selection；返回 SSE                                                                   |
| `GET /backup`                          | v4 完整 ZIP；可用 knowledge_base_id 选择单库（包括回收站）                                                                              |
| `POST /imports`                        | multipart upload 创建副本，返回 knowledge_base_ids 和普通 note_ids；Markdown 包可指定 knowledge_base_id 与 expected_revision 导入当前库 |

正文 `schema_version=2`（历史版本仅在备份导入转换层处理）、`document` 为允许列表校验的 Tiptap JSON；图片仅保存 assetId，
不保存临时 URL。标签最多 30 个、每个 40 字，标题最多 240 字，正文最多 2 MiB。
缺少 expected_revision 返回 422；CAS 冲突返回 409 与 current 完整快照，客户端不得静默覆盖。

写作 action 为 summary、polish、continue、tasks 或 custom；选区必须仍属于保存版本。
SSE 为 `data: {"type":"delta","text":"…"}`、`complete` 或 `error`（含 message），不暴露供应商
原始事件。断开取消生成，调用日志记录脱敏元数据，来源为 thought_workshop_assistant。

备份格式 thought-workshop-backup、version=4（导入转换层兼容 v1/v2/v3），ZIP 中 manifest.json 包含 knowledge_bases、notes 和
assets（folders 恒为空）；每个 asset 声明 id、path、filename、content_type。导入重映射 ID、校验全部文档与文件，
成功才提交；失败回滚并清理暂存文件。复用项目快照的大小和文件数限制，manifest 上限 32 MiB。
Markdown 转换在 Web 所属功能中完成，再经同一个导入 API 校验写入；HTML 和 Markdown 导出读取
受鉴权的笔记、图片与附件，在浏览器内形成离线文件。完整备份上传不在浏览器展开；Markdown 内容包保留 128 MiB 解析限制。

块级 `attachment` 节点保存 `attrs: {assetId, filename, mimeType, byteSize}`。服务端校验公共文件归属并用文件库元数据覆盖展示字段；缺失或跨空间文件返回 404，不支持的类型返回 422。附件支持 pdf、doc/docx、xls/xlsx、ppt/pptx、txt、md、csv、json、zip；复用文件库扩展名、MIME、签名、Office ZIP 结构及实际大小校验，默认单文件 200 MiB（fpl_visual_asset_max_bytes），超限返回 413。下载复用 `GET /v1/files/{asset_id}/download` 的鉴权与 Workspace 隔离。

图片和附件共同受 thought_note_assets 引用保护，包括回收站；删除卡片不删除文件。搜索与 AI 只投影附件文件名。迁移 0045 仅升级现有文档版本标记，保留正文、revision 和引用。

知识库名称最多 120 字，简介最多 2000 字；封面必须引用当前 Workspace 的公共图片。home_note_id 指向独立的空白首页文档，不能单独移动、删除或恢复。知识库回收站状态隐藏全部内容，恢复不会清除文档原有 deleted_at。

知识库与目录修改使用库级 revision；文档保存使用文档 revision。移动文档推进文档修订号，正文 PUT 拒绝变更 knowledge_base_id/parent_id，目录移动只能通过 move。跨库父文档引用及循环嵌套被拒绝。无 notebook_id、文件夹实体或旧笔记本接口，也没有隐式创建默认知识库的生产路径。

0046 迁移保留原文档 ID、正文、标签、收藏、回收站、修订号和附件引用；旧笔记本转成顶层文件夹后移除。首页是独立文档。v3 导入重新分配所有 ID，验证目录与唯一首页、文件归属，文件暂存完成后才进入写事务，失败清理文件与记录。旧 URL 兼容仅在 Web 跳转层。

## 平台治理扩展

仅超级管理员 Session 可调用 `/v1/platform/*`；运营管理员不能借助兼容管理员字段进入中台。账号创建/修改支持 `platform_role: super_admin | admin | member`。账号身份修改仍要求 `expected_revision` 并撤销目标会话与密钥。

| 接口                                                  | 用途                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `GET/POST /v1/platform/registration-invite-codes`     | 搜索分页/创建邀请码；列表仅掩码                                   |
| `PATCH /v1/platform/registration-invite-codes/{id}`   | CAS 修改名额和启停                                                |
| `POST .../{id}/actions`                               | CAS 延期、重设有效期、软删除                                      |
| `POST .../{id}/secret`                                | 近期密码验证后读取明文并审计                                      |
| `GET .../{id}/redemptions`                            | 分页兑换记录                                                      |
| `POST /v1/auth/register`                              | 邀请码、用户名、自选密码、可选邮箱注册登录                        |
| `GET/PUT /v1/platform/model-service-templates/{role}` | 角色模型模板，写入使用 expected_revision                          |
| `POST .../{role}/preview`                             | 使用 expected_template_revision 创建同步预览                      |
| `GET .../{role}/sync-jobs`                            | 最近同步记录                                                      |
| `GET .../sync-jobs/{id}`                              | 任务状态与各空间明细                                              |
| `POST .../sync-jobs/{id}/start`                       | 使用 expected_revision 确认同步                                   |
| `GET /v1/platform/demo-services`                      | 两项固定服务的配置、就绪状态和脱敏记录                            |
| `PUT .../demo-services/{id}`                          | CAS 配置                                                          |
| `POST .../demo-services/{id}/actions`                 | start/stop/reinitialize                                           |
| `POST /v1/account/demo-services/{id}/install`         | 当前空间接入，要求配置权限和 expected_catalog_revision            |
| `GET/PATCH /v1/platform/permission-policy`            | 敏感权限矩阵，CAS 更新                                            |
| `GET/PATCH /v1/platform/runtime-quotas`               | 账号/空间/实例/语音/管理员预留额度，CAS 更新                      |
| `PUT /v1/model-catalog/defaults`                      | expected_revision + default_model_ids，校验当前空间可用模型       |
| `GET /v1/account/developer-documents`                 | 按当前敏感权限返回开发文档目录与正文，禁止缓存                    |
| `GET /v1/account/log-workspaces`                      | Session 专用跨空间日志选择范围                                    |
| `GET /v1/account/cross-workspace-call-logs`           | 显式 workspace_ids 与完整列表筛选查询只读概况；追加 model_options |
| `GET /v1/account/cross-workspace-call-logs/stats`     | 显式 workspace_ids 汇总今日调用、Token、平均耗时与失败数（UTC）   |
| `PATCH /v1/account/project-certification/{kind}/{id}` | visual/galgame 官方标记，is_official + expected_revision          |

`/v1/demo-services/model/chat/completions` 提供认证后的 OpenAI 兼容固定文本、SSE 与工具调用；`/v1/demo-services/tools/{orders|products|product}` 返回固定演示数据。服务默认关闭，关闭返回 503，额度不足返回 429。它们不提供匿名调用或进程控制。

工具 API 与 MCP 配置增加 `sensitive_result`，默认 false。受限身份只收到安全的执行状态；原始结果仅供内部执行或已授权的诊断界面。平台策略每次请求重新计算，密钥不能使用跨空间日志权限。

跨工作区日志的列表与统计均要求 Cookie Session 和 `logs.cross_workspace`，目标必须全部存在；
遗漏 `workspace_ids` 时仍仅查询当前工作区。列表支持与普通日志相同的筛选和日期校验，`q` 额外保留
调用源关键词搜索。`model_options` 从所选工作区全部日志去重生成，不受当前筛选和分页影响。
响应仅含调用概况，不包含原始请求、响应、错误详情或复现包。前端“全部工作区”显式提交可选 ID，
不切换当前工作区；其他空间及全部空间视图不显示详情和删除操作。原日志详情与删除接口仍按当前
Principal 工作区隔离。统计独立于列表筛选，按所选工作区的 UTC 今日口径计算。

## 演示工坊

- `GET /v1/presentation-workshop/projects`：标题搜索 `query`、分页 `offset/limit`，返回首页结构预览与页数。
- `POST /v1/presentation-workshop/projects`：创建文稿；`title` 与 `document` 必填，也用于创建副本。
- `GET /v1/presentation-workshop/projects/{project_id}`：读取完整结构及 revision。
- `PUT /v1/presentation-workshop/projects/{project_id}`：整体更新标题和结构，必填 `expected_revision`。
- `DELETE /v1/presentation-workshop/projects/{project_id}`：必填查询参数 `expected_revision`，释放图片引用。
- `POST /v1/presentation-workshop/projects/{project_id}/export`：请求体 `expected_revision`，返回原生可编辑 PPTX 附件。

读取与导出需要 `content.read`，创建、更新和删除需要 `content.write`；跨 Workspace ID 一律 404。
CAS 缺失返回 422，冲突返回 409 与当前快照。图片复用 `/v1/files` 上传、查询和鉴权读取，
只接受当前空间公共图片，被引用文件删除返回 409。

元素样式支持 `fill_opacity`（0–1，默认 1）、`stroke_dash`（solid/dash/dot，默认 solid）、
`start_arrow` / `end_arrow`（none/triangle/open/circle，默认 none）与 `corner_radius`（0–5000，默认 null 自动圆角）。
箭头用于直线，圆角用于圆角矩形；保存、缩略图、放映与 PPTX 导出共享这些值。
字体包括 Microsoft YaHei、Arial、Consolas；Consolas 在浏览器缺失时回退到等宽字体。

文稿版本 1 使用 1280×720 逻辑坐标。最多 100 页、每页 200 个元素，结构最大 8 MiB；
页面与元素 ID 全文唯一。元素保存位置、尺寸、旋转、锁定、样式、段落或图片 ID 及矩形裁剪。
文字只允许微软雅黑 / Arial 与受控段落格式，不接受任意 HTML 或外部图片 URL。
导出按预期版本拍摄只读快照；全进程同时执行两路导出，繁忙返回 429。
去重图片输入超过 100 MiB 返回 413，缺失或损坏图片返回 422，不静默遗漏对象。
导出文件仅作请求临时附件，完成或失败后清理，不建立后台任务记录。

导出时单张图片最多 2500 万像素，转换为 PNG 后的去重图片总量也限制在 100 MiB 内；超限返回明确错误。

演示文稿图片的 `crop` 表示原图中允许显示的区域；渲染和导出均在该区域内居中等比填满元素框，
实际 PPTX 裁剪值可能大于请求值。导出不会修改保存的文稿或 revision。PPTX 裁剪量化后造成超过
0.1% 的横纵比例误差或可见区域消失时，返回 422、`export_crop_precision`，不输出变形或空白图片。
文稿版本及接口字段不变。

### SVG 与媒体外观

- `POST /v1/files/svg/preview`：需要 `content.write`，JSON `{ "svg": "<svg>…</svg>" }`，
  返回规范化 `svg`、固有 `width/height` 和 `monochrome`；不保存文件。非法内容返回 422 `invalid_svg`。
- `POST /v1/files` 接受 `image/svg+xml`，重新校验并规范化后保存；预检结果不能跳过服务端校验。
- `GET /v1/files` 默认 `include_svg=false`，支持 SVG 的消费者显式传 `true`。位图消费者保持原 MIME 限制。
- `kind=vector` 必须通过 `asset_id` 引用当前 Workspace 的公共 SVG，`image` 只允许位图。
  SVG 与位图共享鉴权内容读取、引用保护和跨空间 404 行为。

媒体外观字段：`opacity`（0–1，默认 1）、`flip_x/flip_y`（默认 false）、
`vector_color`（#RRGGBB 或 null 原色，默认 null）、`image_border`（默认 false）。
图片 `corner_radius=null` 等同零，边框复用 `stroke/stroke_width/stroke_dash`；旧文稿外观不变。
多色 SVG 不允许 `vector_color`。新增原生形状为 rightTriangle、pentagon、hexagon、star、
parallelogram、trapezoid、leftArrow、upArrow、downArrow、doubleArrow、callout、roundCallout、ellipseCallout。

SVG 最大 2 MiB、3000 节点、64 层、总路径 500000 字符，引用展开最多 10000 节点，固有宽高不超过 10000。
支持路径、基本形状、分组变换、渐变、内部引用、裁剪和蒙版；拒绝脚本、事件、动画、外部资源、
网页嵌入、滤镜、嵌入位图与文字（须转路径），不静默移除不支持内容。预览通过 Blob 图片隔离，不注入页面 DOM。
PPTX 嵌入 Office `asvg:svgBlip` 并附带 resvg-py 渲染的 PNG 兼容图；原生形状仍可在 PowerPoint 编辑。

单次导出的 SVG 兼容图最多 512 个、累计 6400 万渲染像素；单张兼容图最长边 4096 像素，超限返回 413。

## Python SDK 与工坊批次

Python 3.11+ 独立包位于 `sdk/python/`，使用 `from future_props_lab import Client, AsyncClient`。文档中心的 Python SDK 教程与 API 模块参考来自版本控制中的方法映射与 OpenAPI；生成入口为 `npm run contracts:generate`。

新增批次接口为视觉 `canvas/operations`、Galgame `story/operations`、录音标注 `document/operations`、演示项目 `operations` 与思绪笔记 `operations`。均使用所属资源的 `expected_revision`、调用者生成的 `request_id` 和 `operations` 列表；一批只更新一个资源，任一操作或最终文档校验失败均不保存。成功只推进一次 revision。相同请求 ID 和相同内容返回已保存回执；请求 ID 相同而内容不同返回 `409 idempotency_conflict`。整体文档保存接口继续可用，网页与 SDK 共享版本和素材引用校验。

ID 集合使用 `insert/update/remove/move/duplicate`，`value` 字段采用对应文档的 JSON 字段名。Galgame Block 在 Fragment ID 跨章节重复时同时提供 `chapter_id` 和 `parent_id`；复制章节或 Fragment 使用显式重新映射稳定 ID 的插入文档。录音标注增加 `split`（`at_ms/new_id`）和 `merge_next`。思绪内容路径是已保存文档 `content` 数组的逐层索引；文本范围使用 Unicode 码点索引，始终强制 revision。

新增内容 API：

- `POST /v1/thought-workshop/markdown/convert`：把 Markdown 转为经过校验的思绪文档，返回格式转换提示；图片与附件 URL 必须通过 `assets` 映射到当前工作区文件 ID，不抓取远程文件。再调用笔记创建或保存接口完成导入。
- `GET /v1/thought-workshop/notes/{note_id}/export`：携带 revision，输出 Markdown 或静态 HTML，有素材时返回包含附件的 ZIP；完整无损备份仍使用已有 backup 接口。
- `GET /v1/audio-annotation/projects/{project_id}/export`：携带文档 revision，导出项目 JSON 或 SRT；不完整标注不能导出 SRT。
- `GET /v1/audio-annotation/projects/{project_id}/segments/{segment_id}/audio`：提取已保存片段的 PCM WAV；`POST` 到同层 `transcribe-saved` 使用已有识别能力，返回识别结果，后续通过版本化编辑保存。
- `POST /v1/files/{asset_id}/frames`：从已上传视频按毫秒位置提取最多 25 帧，返回 PNG 文件 ZIP；4 或 9 帧可输出宫格图。仅使用当前身份可读的文件。

## 独立模型调用

`/v1/model-inference` 不要求模型测试会话或工坊项目。`GET options` 仅列出已启用且实际适配的模型模态和参数；文本使用 `POST text` 或 `POST text/stream`，SSE 事件为 `start/delta/done/error`。日志来源为 `model_inference`。

图片、视频、音乐、音效和语音识别使用 `POST tasks`。请求包含 `request_id`、`model_id`、`kind`、`parameters` 与 `asset_ids`；输入先上传到 `POST assets`，或经 `POST assets/import` 从公共库复制。任务创建后独占输入快照；跨空间 ID 按不存在处理。任务查询、分页列表和结果下载为 GET；结果不会自动进入公共文件库，可显式调用 `save-to-library`。

生成任务复用 GenerationTaskDriver，额度登记与任务同事务。提交中断保持失败，禁止自动重提供应商。若供应商已完成但结果落盘失败，可携带 revision 调用 `retry-materialization`；这不会重新生成。SDK 等待超时只停止客户端等待，保留 ID 供继续查询；断开 SSE 不会重新提交请求。实时语音仍只用于模型测试，沿用 Session WebSocket；SDK 静音暂停发送 PCM，不绑定本机采集设备。

### 图片像素裁剪

`POST /v1/files/{asset_id}/crop` 接受整数 `x`、`y`、`width`、`height`，坐标以 EXIF 方向修正后的原图为准。
需要 `content.read`；跨工作区 ID 返回 404，越界返回 422。响应为保留透明度的 PNG，不修改源素材。
SVG 先通过已有预览转换；动画图片读取第一帧。需要公共文件副本时显式上传返回内容。
