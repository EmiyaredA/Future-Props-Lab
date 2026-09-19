<!-- docs: {"group": "api-modules", "category": "api", "order": 21, "title": "思绪工坊方法参考", "lead": "client.thought 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 思绪工坊方法参考

通过 `client.thought` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [trash_knowledge_base](#trash-knowledge-base) | `DELETE /v1/thought-workshop/knowledge-bases/{project_id}` |
| [delete_note](#delete-note) | `DELETE /v1/thought-workshop/notes/{note_id}` |
| [backup](#backup) | `GET /v1/thought-workshop/backup` |
| [knowledge_bases](#knowledge-bases) | `GET /v1/thought-workshop/knowledge-bases` |
| [knowledge_base](#knowledge-base) | `GET /v1/thought-workshop/knowledge-bases/{project_id}` |
| [directory](#directory) | `GET /v1/thought-workshop/knowledge-bases/{project_id}/directory` |
| [link_preview](#link-preview) | `GET /v1/thought-workshop/link-preview` |
| [writing_models](#writing-models) | `GET /v1/thought-workshop/models` |
| [list_notes](#list-notes) | `GET /v1/thought-workshop/notes` |
| [get_note](#get-note) | `GET /v1/thought-workshop/notes/{note_id}` |
| [export_note_content](#export-note-content) | `GET /v1/thought-workshop/notes/{note_id}/export` |
| [note_history](#note-history) | `GET /v1/thought-workshop/notes/{note_id}/history` |
| [note_history_detail](#note-history-detail) | `GET /v1/thought-workshop/notes/{note_id}/history/{history_id}` |
| [attachments](#attachments) | `POST /v1/thought-workshop/attachments` |
| [upload_image](#upload-image) | `POST /v1/thought-workshop/images` |
| [imports](#imports) | `POST /v1/thought-workshop/imports` |
| [create_knowledge_base](#create-knowledge-base) | `POST /v1/thought-workshop/knowledge-bases` |
| [create_document](#create-document) | `POST /v1/thought-workshop/knowledge-bases/{project_id}/documents` |
| [move_entry](#move-entry) | `POST /v1/thought-workshop/knowledge-bases/{project_id}/move` |
| [restore_knowledge_base](#restore-knowledge-base) | `POST /v1/thought-workshop/knowledge-bases/{project_id}/restore` |
| [convert_markdown](#convert-markdown) | `POST /v1/thought-workshop/markdown/convert` |
| [create_note](#create-note) | `POST /v1/thought-workshop/notes` |
| [assistant](#assistant) | `POST /v1/thought-workshop/notes/{note_id}/assistant` |
| [restore_note_history](#restore-note-history) | `POST /v1/thought-workshop/notes/{note_id}/history/{history_id}/restore` |
| [apply_note_operations](#apply-note-operations) | `POST /v1/thought-workshop/notes/{note_id}/operations` |
| [restore_note](#restore-note) | `POST /v1/thought-workshop/notes/{note_id}/restore` |
| [update_knowledge_base](#update-knowledge-base) | `PUT /v1/thought-workshop/knowledge-bases/{project_id}` |
| [put_note](#put-note) | `PUT /v1/thought-workshop/notes/{note_id}` |

## trash_knowledge_base {#trash-knowledge-base}

`client.thought.trash_knowledge_base(...)`

**接口**：`DELETE /v1/thought-workshop/knowledge-bases/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `KnowledgeBaseOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_note {#delete-note}

`client.thought.delete_note(...)`

**接口**：`DELETE /v1/thought-workshop/notes/{note_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |
| `permanent` | query | boolean | 否 |
| `expected_knowledge_revision` | query | integer | 是 |
| `cascade_children` | query | boolean | 否 |

**响应**：
- `200` · `application/json` · `ThoughtNoteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## backup {#backup}

`client.thought.backup(...)`

**接口**：`GET /v1/thought-workshop/backup`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `knowledge_base_id` | query | string / null | 否 |

**响应**：
- `200` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## knowledge_bases {#knowledge-bases}

`client.thought.knowledge_bases(...)`

**接口**：`GET /v1/thought-workshop/knowledge-bases`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `query` | query | string | 否 |
| `trash` | query | boolean | 否 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## knowledge_base {#knowledge-base}

`client.thought.knowledge_base(...)`

**接口**：`GET /v1/thought-workshop/knowledge-bases/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `KnowledgeBaseOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## directory {#directory}

`client.thought.directory(...)`

**接口**：`GET /v1/thought-workshop/knowledge-bases/{project_id}/directory`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ThoughtDirectoryOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## link_preview {#link-preview}

`client.thought.link_preview(...)`

**接口**：`GET /v1/thought-workshop/link-preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `url` | query | string | 是 |

**响应**：
- `200` · `application/json` · `ThoughtLinkPreview`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## writing_models {#writing-models}

`client.thought.writing_models(...)`

**接口**：`GET /v1/thought-workshop/models`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_notes {#list-notes}

`client.thought.list_notes(...)`

**接口**：`GET /v1/thought-workshop/notes`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `knowledge_base_id` | query | string | 是 |
| `query` | query | string | 否 |
| `parent_id` | query | string | 否 |
| `tag` | query | string | 否 |
| `view` | query | all / recent / favorites / pinned / trash | 否 |
| `sort` | query | updated / title | 否 |
| `offset` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `ThoughtNoteList`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_note {#get-note}

`client.thought.get_note(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ThoughtNoteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_note_content {#export-note-content}

`client.thought.export_note_content(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/export`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |
| `format` | query | md / html | 否 |

**响应**：
- `200` · `application/octet-stream` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## note_history {#note-history}

`client.thought.note_history(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/history`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `cursor` | query | string / null | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `ThoughtHistoryList`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## note_history_detail {#note-history-detail}

`client.thought.note_history_detail(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/history/{history_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `history_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ThoughtHistoryDetail`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## attachments {#attachments}

`client.thought.attachments(...)`

**接口**：`POST /v1/thought-workshop/attachments`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_attachments_v1_thought_workshop_attachments_post | 是 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `ThoughtAttachmentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_image {#upload-image}

`client.thought.upload_image(...)`

**接口**：`POST /v1/thought-workshop/images`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_upload_image_v1_thought_workshop_images_post | 是 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `ThoughtImageOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## imports {#imports}

`client.thought.imports(...)`

**接口**：`POST /v1/thought-workshop/imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `knowledge_base_id` | query | string / null | 否 |
| `expected_revision` | query | integer / null | 否 |
| `body` | multipart/form-data | Body_imports_v1_thought_workshop_imports_post | 是 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `ThoughtImportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_knowledge_base {#create-knowledge-base}

`client.thought.create_knowledge_base(...)`

**接口**：`POST /v1/thought-workshop/knowledge-bases`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | KnowledgeBaseIn | 是 |
| `body.cover_asset_id` | 请求体 | string / null | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `KnowledgeBaseOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_document {#create-document}

`client.thought.create_document(...)`

**接口**：`POST /v1/thought-workshop/knowledge-bases/{project_id}/documents`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | KnowledgeNoteCreate | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.parent_id` | 请求体 | string / null | 否 |
| `body.title` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `ThoughtNoteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## move_entry {#move-entry}

`client.thought.move_entry(...)`

**接口**：`POST /v1/thought-workshop/knowledge-bases/{project_id}/move`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | ThoughtMoveIn | 是 |
| `body.before_id` | 请求体 | string / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.item_id` | 请求体 | string | 是 |
| `body.parent_id` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `ThoughtDirectoryOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## restore_knowledge_base {#restore-knowledge-base}

`client.thought.restore_knowledge_base(...)`

**接口**：`POST /v1/thought-workshop/knowledge-bases/{project_id}/restore`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | ThoughtRevisionIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `KnowledgeBaseOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## convert_markdown {#convert-markdown}

`client.thought.convert_markdown(...)`

**接口**：`POST /v1/thought-workshop/markdown/convert`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ThoughtMarkdownIn | 是 |
| `body.assets` | 请求体 | object | 否 |
| `body.markdown` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ThoughtMarkdownOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_note {#create-note}

`client.thought.create_note(...)`

**接口**：`POST /v1/thought-workshop/notes`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ThoughtNoteCreate | 是 |
| `body.document` | 请求体 | object | 否 |
| `body.expected_knowledge_revision` | 请求体 | integer | 是 |
| `body.favorite` | 请求体 | boolean | 否 |
| `body.knowledge_base_id` | 请求体 | string | 是 |
| `body.parent_id` | 请求体 | string / null | 否 |
| `body.pinned` | 请求体 | boolean | 否 |
| `body.schema_version` | 请求体 | integer | 否 |
| `body.tags` | 请求体 | array | 否 |
| `body.title` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `ThoughtNoteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## assistant {#assistant}

`client.thought.assistant(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/assistant`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | ThoughtAssistantIn | 是 |
| `body.action` | 请求体 | summary / polish / continue / tasks / custom | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.instruction` | 请求体 | string | 否 |
| `body.model_id` | 请求体 | string | 是 |
| `body.selection` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `object`
- `200` · `text/event-stream` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## restore_note_history {#restore-note-history}

`client.thought.restore_note_history(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/history/{history_id}/restore`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `history_id` | path | string | 是 |
| `body` | application/json | ThoughtRevisionIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `ThoughtNoteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_note_operations {#apply-note-operations}

`client.thought.apply_note_operations(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/operations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | ThoughtOperationsIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.operations` | 请求体 | array | 是 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ThoughtNoteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## restore_note {#restore-note}

`client.thought.restore_note(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/restore`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | ThoughtNoteTransitionIn | 是 |
| `body.expected_knowledge_revision` | 请求体 | integer | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `ThoughtNoteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_knowledge_base {#update-knowledge-base}

`client.thought.update_knowledge_base(...)`

**接口**：`PUT /v1/thought-workshop/knowledge-bases/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | KnowledgeBasePut | 是 |
| `body.cover_asset_id` | 请求体 | string / null | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `KnowledgeBaseOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_note {#put-note}

`client.thought.put_note(...)`

**接口**：`PUT /v1/thought-workshop/notes/{note_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | ThoughtNotePut | 是 |
| `body.document` | 请求体 | object | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.favorite` | 请求体 | boolean | 否 |
| `body.knowledge_base_id` | 请求体 | string | 是 |
| `body.parent_id` | 请求体 | string / null | 否 |
| `body.pinned` | 请求体 | boolean | 否 |
| `body.schema_version` | 请求体 | integer | 否 |
| `body.tags` | 请求体 | array | 否 |
| `body.title` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `ThoughtNoteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
