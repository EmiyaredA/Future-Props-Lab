<!-- docs: {"group": "api-modules", "category": "api", "order": 21, "title": "模型测试方法参考", "lead": "client.testing 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 模型测试方法参考

通过 `client.testing` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_conversation](#delete-conversation) | `DELETE /v1/model-test/conversations/{conversation_id}` |
| [delete_attachment](#delete-attachment) | `DELETE /v1/model-test/conversations/{conversation_id}/attachments/{attachment_id}` |
| [delete_generation_asset](#delete-generation-asset) | `DELETE /v1/model-test/generation-assets/{asset_id}` |
| [delete_generation_task](#delete-generation-task) | `DELETE /v1/model-test/generation-tasks/{task_id}` |
| [delete_transcription_task](#delete-transcription-task) | `DELETE /v1/model-test/transcription-tasks/{task_id}` |
| [list_conversations](#list-conversations) | `GET /v1/model-test/conversations` |
| [get_conversation](#get-conversation) | `GET /v1/model-test/conversations/{conversation_id}` |
| [attachment_content](#attachment-content) | `GET /v1/model-test/conversations/{conversation_id}/attachments/{attachment_id}/content` |
| [generation_asset_backfill_status](#generation-asset-backfill-status) | `GET /v1/model-test/generation-assets/backfill-status` |
| [generation_options](#generation-options) | `GET /v1/model-test/generation-options` |
| [list_generation_tasks](#list-generation-tasks) | `GET /v1/model-test/generation-tasks` |
| [get_generation_task](#get-generation-task) | `GET /v1/model-test/generation-tasks/{task_id}` |
| [generation_content](#generation-content) | `GET /v1/model-test/generation-tasks/{task_id}/content` |
| [realtime_options](#realtime-options) | `GET /v1/model-test/realtime-options` |
| [transcription_options](#transcription-options) | `GET /v1/model-test/transcription-options` |
| [list_transcription_tasks](#list-transcription-tasks) | `GET /v1/model-test/transcription-tasks` |
| [get_transcription_task](#get-transcription-task) | `GET /v1/model-test/transcription-tasks/{task_id}` |
| [transcription_input_content](#transcription-input-content) | `GET /v1/model-test/transcription-tasks/{task_id}/input-content` |
| [patch_conversation](#patch-conversation) | `PATCH /v1/model-test/conversations/{conversation_id}` |
| [create_conversation](#create-conversation) | `POST /v1/model-test/conversations` |
| [upload_attachments](#upload-attachments) | `POST /v1/model-test/conversations/{conversation_id}/attachments` |
| [stream_message](#stream-message) | `POST /v1/model-test/conversations/{conversation_id}/messages/stream` |
| [regenerate_message](#regenerate-message) | `POST /v1/model-test/conversations/{conversation_id}/regenerate/stream` |
| [upload_generation_assets](#upload-generation-assets) | `POST /v1/model-test/generation-assets` |
| [backfill_generation_assets](#backfill-generation-assets) | `POST /v1/model-test/generation-assets/backfill` |
| [cleanup_generation_assets](#cleanup-generation-assets) | `POST /v1/model-test/generation-assets/cleanup` |
| [create_generation_task](#create-generation-task) | `POST /v1/model-test/generation-tasks` |
| [retry_materialization](#retry-materialization) | `POST /v1/model-test/generation-tasks/{task_id}/retry-materialization` |
| [create_transcription_task](#create-transcription-task) | `POST /v1/model-test/transcription-tasks` |
| [upload_transcription_task](#upload-transcription-task) | `POST /v1/model-test/transcription-tasks/upload` |

## delete_conversation {#delete-conversation}

`client.testing.delete_conversation(...)`

**接口**：`DELETE /v1/model-test/conversations/{conversation_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_attachment {#delete-attachment}

`client.testing.delete_attachment(...)`

**接口**：`DELETE /v1/model-test/conversations/{conversation_id}/attachments/{attachment_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `attachment_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_generation_asset {#delete-generation-asset}

`client.testing.delete_generation_asset(...)`

**接口**：`DELETE /v1/model-test/generation-assets/{asset_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `asset_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_generation_task {#delete-generation-task}

`client.testing.delete_generation_task(...)`

**接口**：`DELETE /v1/model-test/generation-tasks/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_transcription_task {#delete-transcription-task}

`client.testing.delete_transcription_task(...)`

**接口**：`DELETE /v1/model-test/transcription-tasks/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_conversations {#list-conversations}

`client.testing.list_conversations(...)`

**接口**：`GET /v1/model-test/conversations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ModelTestConversationListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_conversation {#get-conversation}

`client.testing.get_conversation(...)`

**接口**：`GET /v1/model-test/conversations/{conversation_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ModelTestConversationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## attachment_content {#attachment-content}

`client.testing.attachment_content(...)`

**接口**：`GET /v1/model-test/conversations/{conversation_id}/attachments/{attachment_id}/content`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `attachment_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## generation_asset_backfill_status {#generation-asset-backfill-status}

`client.testing.generation_asset_backfill_status(...)`

**接口**：`GET /v1/model-test/generation-assets/backfill-status`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ModelTestGenerationAssetBackfillStatusOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## generation_options {#generation-options}

`client.testing.generation_options(...)`

**接口**：`GET /v1/model-test/generation-options`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ModelTestGenerationOptionListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_generation_tasks {#list-generation-tasks}

`client.testing.list_generation_tasks(...)`

**接口**：`GET /v1/model-test/generation-tasks`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `model_id` | query | string / null | 否 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `ModelTestGenerationTaskListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_generation_task {#get-generation-task}

`client.testing.get_generation_task(...)`

**接口**：`GET /v1/model-test/generation-tasks/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ModelTestGenerationTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## generation_content {#generation-content}

`client.testing.generation_content(...)`

**接口**：`GET /v1/model-test/generation-tasks/{task_id}/content`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## realtime_options {#realtime-options}

`client.testing.realtime_options(...)`

**接口**：`GET /v1/model-test/realtime-options`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `RealtimeVoiceOptionsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## transcription_options {#transcription-options}

`client.testing.transcription_options(...)`

**接口**：`GET /v1/model-test/transcription-options`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ModelTestTranscriptionOptionListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_transcription_tasks {#list-transcription-tasks}

`client.testing.list_transcription_tasks(...)`

**接口**：`GET /v1/model-test/transcription-tasks`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `model_id` | query | string / null | 否 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `ModelTestTranscriptionTaskListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_transcription_task {#get-transcription-task}

`client.testing.get_transcription_task(...)`

**接口**：`GET /v1/model-test/transcription-tasks/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ModelTestTranscriptionTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## transcription_input_content {#transcription-input-content}

`client.testing.transcription_input_content(...)`

**接口**：`GET /v1/model-test/transcription-tasks/{task_id}/input-content`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_conversation {#patch-conversation}

`client.testing.patch_conversation(...)`

**接口**：`PATCH /v1/model-test/conversations/{conversation_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `body` | application/json | ModelTestConversationPatchIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.max_tokens` | 请求体 | integer / null | 否 |
| `body.model_id` | 请求体 | string / null | 否 |
| `body.system_prompt` | 请求体 | string / null | 否 |
| `body.temperature` | 请求体 | number / null | 否 |
| `body.title` | 请求体 | string / null | 否 |
| `body.tool_ids` | 请求体 | array / null | 否 |

**响应**：
- `200` · `application/json` · `ModelTestConversationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_conversation {#create-conversation}

`client.testing.create_conversation(...)`

**接口**：`POST /v1/model-test/conversations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ModelTestConversationCreateIn | 是 |
| `body.model_id` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `ModelTestConversationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_attachments {#upload-attachments}

`client.testing.upload_attachments(...)`

**接口**：`POST /v1/model-test/conversations/{conversation_id}/attachments`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_attachments_v1_model_test_conversations__conversation_id__attachments_post | 是 |
| `body.files` | 请求体 | array | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `ModelTestAttachmentListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## stream_message {#stream-message}

`client.testing.stream_message(...)`

**接口**：`POST /v1/model-test/conversations/{conversation_id}/messages/stream`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `body` | application/json | ModelTestSendIn | 是 |
| `body.attachment_ids` | 请求体 | array | 否 |
| `body.content` | 请求体 | string | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## regenerate_message {#regenerate-message}

`client.testing.regenerate_message(...)`

**接口**：`POST /v1/model-test/conversations/{conversation_id}/regenerate/stream`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `body` | application/json | ModelTestRegenerateIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_generation_assets {#upload-generation-assets}

`client.testing.upload_generation_assets(...)`

**接口**：`POST /v1/model-test/generation-assets`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_upload_generation_assets_v1_model_test_generation_assets_post | 是 |
| `body.files` | 请求体 | array | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `ModelTestGenerationAssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## backfill_generation_assets {#backfill-generation-assets}

`client.testing.backfill_generation_assets(...)`

**接口**：`POST /v1/model-test/generation-assets/backfill`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `ModelTestGenerationAssetBackfillOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cleanup_generation_assets {#cleanup-generation-assets}

`client.testing.cleanup_generation_assets(...)`

**接口**：`POST /v1/model-test/generation-assets/cleanup`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ModelTestGenerationAssetCleanupOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_generation_task {#create-generation-task}

`client.testing.create_generation_task(...)`

**接口**：`POST /v1/model-test/generation-tasks`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ModelTestImageGenerationIn / ModelTestVideoGenerationIn | 是 |

**响应**：
- `200` · `application/json` · `ModelTestGenerationTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## retry_materialization {#retry-materialization}

`client.testing.retry_materialization(...)`

**接口**：`POST /v1/model-test/generation-tasks/{task_id}/retry-materialization`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ModelTestGenerationTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_transcription_task {#create-transcription-task}

`client.testing.create_transcription_task(...)`

**接口**：`POST /v1/model-test/transcription-tasks`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ModelTestTranscriptionCreateIn | 是 |
| `body.abbreviations` | 请求体 | boolean / null | 否 |
| `body.enable_punctuation` | 请求体 | boolean / null | 否 |
| `body.enable_speaker_diarization` | 请求体 | boolean / null | 否 |
| `body.enable_text_edit` | 请求体 | boolean / null | 否 |
| `body.enable_word_timestamps` | 请求体 | boolean / null | 否 |
| `body.hotwords` | 请求体 | string / null | 否 |
| `body.language` | 请求体 | string / null | 否 |
| `body.max_speakers` | 请求体 | integer / null | 否 |
| `body.model_id` | 请求体 | string | 是 |
| `body.source_asset_id` | 请求体 | string | 是 |
| `body.target_language` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `ModelTestTranscriptionTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_transcription_task {#upload-transcription-task}

`client.testing.upload_transcription_task(...)`

**接口**：`POST /v1/model-test/transcription-tasks/upload`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_upload_transcription_task_v1_model_test_transcription_tasks_upload_post | 是 |
| `body.abbreviations` | 请求体 | boolean / null | 否 |
| `body.enable_punctuation` | 请求体 | boolean / null | 否 |
| `body.enable_speaker_diarization` | 请求体 | boolean / null | 否 |
| `body.enable_text_edit` | 请求体 | boolean / null | 否 |
| `body.enable_word_timestamps` | 请求体 | boolean / null | 否 |
| `body.hotwords` | 请求体 | string / null | 否 |
| `body.language` | 请求体 | string / null | 否 |
| `body.max_speakers` | 请求体 | integer / null | 否 |
| `body.model_id` | 请求体 | string | 是 |
| `body.target_language` | 请求体 | string / null | 否 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `ModelTestTranscriptionTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
