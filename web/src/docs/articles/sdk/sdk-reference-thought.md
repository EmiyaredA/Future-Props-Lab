<!-- docs: {"group": "api-modules", "category": "api", "order": 28, "title": "思绪工坊方法参考", "lead": "client.thought 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 思绪工坊方法参考

通过 `client.thought` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [trash_knowledge_base](#trash-knowledge-base) | `DELETE /v1/thought-workshop/knowledge-bases/{project_id}` |
| [delete_note](#delete-note) | `DELETE /v1/thought-workshop/notes/{note_id}` |
| [delete_checkpoint](#delete-checkpoint) | `DELETE /v1/thought-workshop/notes/{note_id}/checkpoints/{checkpoint_id}` |
| [unbind](#unbind) | `DELETE /v1/thought-workshop/notes/{note_id}/external-sync/binding` |
| [delete_filter](#delete-filter) | `DELETE /v1/thought-workshop/preferences/filters/{filter_id}` |
| [delete_template](#delete-template) | `DELETE /v1/thought-workshop/templates/{template_id}` |
| [backup](#backup) | `GET /v1/thought-workshop/backup` |
| [knowledge_bases](#knowledge-bases) | `GET /v1/thought-workshop/knowledge-bases` |
| [knowledge_base](#knowledge-base) | `GET /v1/thought-workshop/knowledge-bases/{project_id}` |
| [directory](#directory) | `GET /v1/thought-workshop/knowledge-bases/{project_id}/directory` |
| [library_export_snapshot](#library-export-snapshot) | `GET /v1/thought-workshop/knowledge-bases/{project_id}/export-snapshot` |
| [link_preview](#link-preview) | `GET /v1/thought-workshop/link-preview` |
| [writing_models](#writing-models) | `GET /v1/thought-workshop/models` |
| [list_notes](#list-notes) | `GET /v1/thought-workshop/notes` |
| [get_note](#get-note) | `GET /v1/thought-workshop/notes/{note_id}` |
| [note_backlinks](#note-backlinks) | `GET /v1/thought-workshop/notes/{note_id}/backlinks` |
| [checkpoints](#checkpoints) | `GET /v1/thought-workshop/notes/{note_id}/checkpoints` |
| [copy_snapshot](#copy-snapshot) | `GET /v1/thought-workshop/notes/{note_id}/copy-snapshot` |
| [export_note_content](#export-note-content) | `GET /v1/thought-workshop/notes/{note_id}/export` |
| [state](#state) | `GET /v1/thought-workshop/notes/{note_id}/external-sync` |
| [task](#task) | `GET /v1/thought-workshop/notes/{note_id}/external-sync/tasks/{task_id}` |
| [note_history](#note-history) | `GET /v1/thought-workshop/notes/{note_id}/history` |
| [note_history_detail](#note-history-detail) | `GET /v1/thought-workshop/notes/{note_id}/history/{history_id}` |
| [get_multitable](#get-multitable) | `GET /v1/thought-workshop/notes/{note_id}/multitable` |
| [list_multitable_history](#list-multitable-history) | `GET /v1/thought-workshop/notes/{note_id}/multitable/history` |
| [get_multitable_history](#get-multitable-history) | `GET /v1/thought-workshop/notes/{note_id}/multitable/history/{revision}` |
| [saved_filters](#saved-filters) | `GET /v1/thought-workshop/preferences/filters` |
| [reading_position](#reading-position) | `GET /v1/thought-workshop/preferences/reading` |
| [recently_visited](#recently-visited) | `GET /v1/thought-workshop/preferences/recent` |
| [global_search](#global-search) | `GET /v1/thought-workshop/search` |
| [templates](#templates) | `GET /v1/thought-workshop/templates` |
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
| [create_checkpoint](#create-checkpoint) | `POST /v1/thought-workshop/notes/{note_id}/checkpoints` |
| [duplicate_document](#duplicate-document) | `POST /v1/thought-workshop/notes/{note_id}/duplicate` |
| [preview](#preview) | `POST /v1/thought-workshop/notes/{note_id}/external-sync/preview` |
| [submit](#submit) | `POST /v1/thought-workshop/notes/{note_id}/external-sync/tasks` |
| [reconcile](#reconcile) | `POST /v1/thought-workshop/notes/{note_id}/external-sync/tasks/{task_id}/reconcile` |
| [restore_note_history](#restore-note-history) | `POST /v1/thought-workshop/notes/{note_id}/history/{history_id}/restore` |
| [preview_multitable_conversion](#preview-multitable-conversion) | `POST /v1/thought-workshop/notes/{note_id}/multitable/conversion-preview` |
| [preview_multitable_csv](#preview-multitable-csv) | `POST /v1/thought-workshop/notes/{note_id}/multitable/csv-preview` |
| [restore_multitable_history](#restore-multitable-history) | `POST /v1/thought-workshop/notes/{note_id}/multitable/history/{revision}/restore` |
| [apply_multitable_operations](#apply-multitable-operations) | `POST /v1/thought-workshop/notes/{note_id}/multitable/operations` |
| [export_multitable_csv](#export-multitable-csv) | `POST /v1/thought-workshop/notes/{note_id}/multitable/tables/{table_id}/csv-export` |
| [import_multitable_csv](#import-multitable-csv) | `POST /v1/thought-workshop/notes/{note_id}/multitable/tables/{table_id}/csv-import` |
| [query_multitable_records](#query-multitable-records) | `POST /v1/thought-workshop/notes/{note_id}/multitable/tables/{table_id}/query` |
| [apply_note_operations](#apply-note-operations) | `POST /v1/thought-workshop/notes/{note_id}/operations` |
| [restore_note](#restore-note) | `POST /v1/thought-workshop/notes/{note_id}/restore` |
| [save_filter](#save-filter) | `POST /v1/thought-workshop/preferences/filters` |
| [record_reading](#record-reading) | `POST /v1/thought-workshop/preferences/reading` |
| [resolve_references](#resolve-references) | `POST /v1/thought-workshop/references/resolve` |
| [create_template](#create-template) | `POST /v1/thought-workshop/templates` |
| [apply_template](#apply-template) | `POST /v1/thought-workshop/templates/{template_id}/apply` |
| [update_knowledge_base](#update-knowledge-base) | `PUT /v1/thought-workshop/knowledge-bases/{project_id}` |
| [put_note](#put-note) | `PUT /v1/thought-workshop/notes/{note_id}` |
| [rename_checkpoint](#rename-checkpoint) | `PUT /v1/thought-workshop/notes/{note_id}/checkpoints/{checkpoint_id}` |
| [bind](#bind) | `PUT /v1/thought-workshop/notes/{note_id}/external-sync/binding` |
| [put_filter](#put-filter) | `PUT /v1/thought-workshop/preferences/filters/{filter_id}` |
| [put_template](#put-template) | `PUT /v1/thought-workshop/templates/{template_id}` |

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

## delete_checkpoint {#delete-checkpoint}

`client.thought.delete_checkpoint(...)`

**接口**：`DELETE /v1/thought-workshop/notes/{note_id}/checkpoints/{checkpoint_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `checkpoint_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## unbind {#unbind}

`client.thought.unbind(...)`

**接口**：`DELETE /v1/thought-workshop/notes/{note_id}/external-sync/binding`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_filter {#delete-filter}

`client.thought.delete_filter(...)`

**接口**：`DELETE /v1/thought-workshop/preferences/filters/{filter_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `filter_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_template {#delete-template}

`client.thought.delete_template(...)`

**接口**：`DELETE /v1/thought-workshop/templates/{template_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `template_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

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

## library_export_snapshot {#library-export-snapshot}

`client.thought.library_export_snapshot(...)`

**接口**：`GET /v1/thought-workshop/knowledge-bases/{project_id}/export-snapshot`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `LibraryExportSnapshot`

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

## note_backlinks {#note-backlinks}

`client.thought.note_backlinks(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/backlinks`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `offset` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## checkpoints {#checkpoints}

`client.thought.checkpoints(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/checkpoints`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## copy_snapshot {#copy-snapshot}

`client.thought.copy_snapshot(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/copy-snapshot`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `subtree` | query | boolean | 否 |

**响应**：
- `200` · `application/json` · `DuplicateSnapshot`

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

## state {#state}

`client.thought.state(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/external-sync`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ArticleSyncState`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## task {#task}

`client.thought.task(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/external-sync/tasks/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ArticleSyncTaskOut`

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

## get_multitable {#get-multitable}

`client.thought.get_multitable(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/multitable`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `Structure`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_multitable_history {#list-multitable-history}

`client.thought.list_multitable_history(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/multitable/history`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `offset` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_multitable_history {#get-multitable-history}

`client.thought.get_multitable_history(...)`

**接口**：`GET /v1/thought-workshop/notes/{note_id}/multitable/history/{revision}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `revision` | path | integer | 是 |

**响应**：
- `200` · `application/json` · `Snapshot`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## saved_filters {#saved-filters}

`client.thought.saved_filters(...)`

**接口**：`GET /v1/thought-workshop/preferences/filters`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## reading_position {#reading-position}

`client.thought.reading_position(...)`

**接口**：`GET /v1/thought-workshop/preferences/reading`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `resource_id` | query | string | 是 |

**响应**：
- `200` · `application/json` · `ReadingOut / null`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## recently_visited {#recently-visited}

`client.thought.recently_visited(...)`

**接口**：`GET /v1/thought-workshop/preferences/recent`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## global_search {#global-search}

`client.thought.global_search(...)`

**接口**：`GET /v1/thought-workshop/search`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `query` | query | string | 否 |
| `knowledge_base_id` | query | string / null | 否 |
| `tag` | query | string | 否 |
| `favorite` | query | boolean | 否 |
| `title_only` | query | boolean | 否 |
| `offset` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `SearchResult`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## templates {#templates}

`client.thought.templates(...)`

**接口**：`GET /v1/thought-workshop/templates`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `array`

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
| `body.kind` | 请求体 | note / multitable | 否 |
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
| `body.kind` | 请求体 | note / multitable | 否 |
| `body.knowledge_base_id` | 请求体 | string | 是 |
| `body.parent_id` | 请求体 | string / null | 否 |
| `body.pinned` | 请求体 | boolean | 否 |
| `body.schema_version` | 请求体 | 2 / 3 | 否 |
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

## create_checkpoint {#create-checkpoint}

`client.thought.create_checkpoint(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/checkpoints`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | CheckpointIn | 是 |
| `body.expected_note_revision` | 请求体 | integer | 是 |
| `body.history_id` | 请求体 | string | 是 |
| `body.name` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `CheckpointOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## duplicate_document {#duplicate-document}

`client.thought.duplicate_document(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/duplicate`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | DuplicateIn | 是 |
| `body.expected_knowledge_revision` | 请求体 | integer | 是 |
| `body.expected_revisions` | 请求体 | object | 是 |
| `body.knowledge_base_id` | 请求体 | string | 是 |
| `body.parent_id` | 请求体 | string / null | 否 |
| `body.source_knowledge_revision` | 请求体 | integer | 是 |
| `body.subtree` | 请求体 | boolean | 否 |

**响应**：
- `200` · `application/json` · `DuplicateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview {#preview}

`client.thought.preview(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/external-sync/preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | ArticlePreviewInput | 是 |
| `body.binding_revision` | 请求体 | integer | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `ArticleSyncPreview`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## submit {#submit}

`client.thought.submit(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/external-sync/tasks`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | ArticleSyncSubmit | 是 |
| `body.confirm_replace` | 请求体 | boolean | 是 |
| `body.operation_id` | 请求体 | string | 是 |
| `body.preview_id` | 请求体 | string | 是 |

**响应**：
- `202` · `application/json` · `ArticleSyncTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## reconcile {#reconcile}

`client.thought.reconcile(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/external-sync/tasks/{task_id}/reconcile`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `task_id` | path | string | 是 |
| `body` | application/json | ArticleSyncReconcile | 是 |
| `body.acknowledge_partial` | 请求体 | boolean | 否 |

**响应**：
- `200` · `application/json` · `ArticleSyncReconcileOut`

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

## preview_multitable_conversion {#preview-multitable-conversion}

`client.thought.preview_multitable_conversion(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/multitable/conversion-preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | ConversionIn | 是 |
| `body.table` | 请求体 | TableSpec | 是 |

**响应**：
- `200` · `application/json` · `ConversionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_multitable_csv {#preview-multitable-csv}

`client.thought.preview_multitable_csv(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/multitable/csv-preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | CsvSource | 是 |
| `body.csv` | 请求体 | string | 是 |
| `body.header` | 请求体 | boolean | 否 |
| `body.mapping` | 请求体 | array / null | 否 |
| `body.table` | 请求体 | TableSpec / null | 否 |

**响应**：
- `200` · `application/json` · `CsvPreview`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## restore_multitable_history {#restore-multitable-history}

`client.thought.restore_multitable_history(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/multitable/history/{revision}/restore`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `revision` | path | integer | 是 |
| `body` | application/json | RestoreIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `BatchOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_multitable_operations {#apply-multitable-operations}

`client.thought.apply_multitable_operations(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/multitable/operations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | BatchIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.operations` | 请求体 | array | 是 |

**响应**：
- `200` · `application/json` · `BatchOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_multitable_csv {#export-multitable-csv}

`client.thought.export_multitable_csv(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/multitable/tables/{table_id}/csv-export`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `table_id` | path | string | 是 |
| `body` | application/json | QueryIn | 是 |
| `body.limit` | 请求体 | integer | 否 |
| `body.offset` | 请求体 | integer | 否 |
| `body.search` | 请求体 | string | 否 |
| `body.view_id` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_multitable_csv {#import-multitable-csv}

`client.thought.import_multitable_csv(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/multitable/tables/{table_id}/csv-import`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `table_id` | path | string | 是 |
| `body` | application/json | CsvIn | 是 |
| `body.csv` | 请求体 | string | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.header` | 请求体 | boolean | 否 |
| `body.mapping` | 请求体 | array | 是 |
| `body.table` | 请求体 | TableSpec / null | 否 |

**响应**：
- `200` · `application/json` · `BatchOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## query_multitable_records {#query-multitable-records}

`client.thought.query_multitable_records(...)`

**接口**：`POST /v1/thought-workshop/notes/{note_id}/multitable/tables/{table_id}/query`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `table_id` | path | string | 是 |
| `body` | application/json | QueryIn | 是 |
| `body.limit` | 请求体 | integer | 否 |
| `body.offset` | 请求体 | integer | 否 |
| `body.search` | 请求体 | string | 否 |
| `body.view_id` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `RecordPage`

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

## save_filter {#save-filter}

`client.thought.save_filter(...)`

**接口**：`POST /v1/thought-workshop/preferences/filters`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | SavedFilterIn | 是 |
| `body.criteria` | 请求体 | SearchCriteria | 是 |
| `body.name` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `SavedFilterOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## record_reading {#record-reading}

`client.thought.record_reading(...)`

**接口**：`POST /v1/thought-workshop/preferences/reading`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ReadingIn | 是 |
| `body.position` | 请求体 | ReadingPosition | 否 |
| `body.resource_id` | 请求体 | string | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ReadingOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## resolve_references {#resolve-references}

`client.thought.resolve_references(...)`

**接口**：`POST /v1/thought-workshop/references/resolve`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ResolveReferences | 是 |
| `body.ids` | 请求体 | array | 是 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_template {#create-template}

`client.thought.create_template(...)`

**接口**：`POST /v1/thought-workshop/templates`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | TemplateIn | 是 |
| `body.description` | 请求体 | string | 否 |
| `body.document` | 请求体 | object | 是 |
| `body.kind` | 请求体 | note / multitable | 否 |
| `body.multitable` | 请求体 | Snapshot / null | 否 |
| `body.name` | 请求体 | string | 是 |
| `body.schema_version` | 请求体 | 2 / 3 | 否 |
| `body.tags` | 请求体 | array | 否 |

**响应**：
- `200` · `application/json` · `TemplateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_template {#apply-template}

`client.thought.apply_template(...)`

**接口**：`POST /v1/thought-workshop/templates/{template_id}/apply`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `template_id` | path | string | 是 |
| `body` | application/json | TemplateApply | 是 |
| `body.expected_knowledge_revision` | 请求体 | integer | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.knowledge_base_id` | 请求体 | string | 是 |
| `body.parent_id` | 请求体 | string / null | 否 |
| `body.title` | 请求体 | string | 是 |

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
| `body.kind` | 请求体 | note / multitable | 否 |
| `body.knowledge_base_id` | 请求体 | string | 是 |
| `body.parent_id` | 请求体 | string / null | 否 |
| `body.pinned` | 请求体 | boolean | 否 |
| `body.schema_version` | 请求体 | 2 / 3 | 否 |
| `body.tags` | 请求体 | array | 否 |
| `body.title` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `ThoughtNoteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## rename_checkpoint {#rename-checkpoint}

`client.thought.rename_checkpoint(...)`

**接口**：`PUT /v1/thought-workshop/notes/{note_id}/checkpoints/{checkpoint_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `checkpoint_id` | path | string | 是 |
| `body` | application/json | CheckpointPut | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.name` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `CheckpointOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## bind {#bind}

`client.thought.bind(...)`

**接口**：`PUT /v1/thought-workshop/notes/{note_id}/external-sync/binding`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `note_id` | path | string | 是 |
| `body` | application/json | ArticleBindingInput | 是 |
| `body.connection_id` | 请求体 | string | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.url` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ArticleBindingOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_filter {#put-filter}

`client.thought.put_filter(...)`

**接口**：`PUT /v1/thought-workshop/preferences/filters/{filter_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `filter_id` | path | string | 是 |
| `body` | application/json | SavedFilterPut | 是 |
| `body.criteria` | 请求体 | SearchCriteria | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.name` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `SavedFilterOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_template {#put-template}

`client.thought.put_template(...)`

**接口**：`PUT /v1/thought-workshop/templates/{template_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `template_id` | path | string | 是 |
| `body` | application/json | TemplatePut | 是 |
| `body.description` | 请求体 | string | 否 |
| `body.document` | 请求体 | object | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.kind` | 请求体 | note / multitable | 否 |
| `body.multitable` | 请求体 | Snapshot / null | 否 |
| `body.name` | 请求体 | string | 是 |
| `body.schema_version` | 请求体 | 2 / 3 | 否 |
| `body.tags` | 请求体 | array | 否 |

**响应**：
- `200` · `application/json` · `TemplateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
