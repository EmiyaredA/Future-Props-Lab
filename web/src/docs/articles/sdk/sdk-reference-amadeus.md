<!-- docs: {"group": "api-modules", "category": "api", "order": 2, "title": "Amadeus 桌面助手方法参考", "lead": "client.amadeus 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# Amadeus 桌面助手方法参考

通过 `client.amadeus` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_conversation](#delete-conversation) | `DELETE /v1/amadeus/conversations/{conversation_id}` |
| [list_conversations](#list-conversations) | `GET /v1/amadeus/conversations` |
| [get_conversation](#get-conversation) | `GET /v1/amadeus/conversations/{conversation_id}` |
| [files_list](#files-list) | `GET /v1/amadeus/conversations/{conversation_id}/files` |
| [file_download](#file-download) | `GET /v1/amadeus/conversations/{conversation_id}/files/{kind}/{name}` |
| [list_runs](#list-runs) | `GET /v1/amadeus/conversations/{conversation_id}/runs` |
| [get_run](#get-run) | `GET /v1/amadeus/conversations/{conversation_id}/runs/{run_id}` |
| [skill_file_read](#skill-file-read) | `GET /v1/amadeus/conversations/{conversation_id}/skills/{skill_id}/{version}/files/{relative_path}` |
| [list_registered_operations](#list-registered-operations) | `GET /v1/amadeus/operations` |
| [active_run](#active-run) | `GET /v1/amadeus/runs/active` |
| [script_capability](#script-capability) | `GET /v1/amadeus/script-capability` |
| [patch_conversation](#patch-conversation) | `PATCH /v1/amadeus/conversations/{conversation_id}` |
| [create_conversation](#create-conversation) | `POST /v1/amadeus/conversations` |
| [propose_action](#propose-action) | `POST /v1/amadeus/conversations/{conversation_id}/actions` |
| [stop_action](#stop-action) | `POST /v1/amadeus/conversations/{conversation_id}/actions/{action_id}/cancel` |
| [decide_action](#decide-action) | `POST /v1/amadeus/conversations/{conversation_id}/actions/{action_id}/decision` |
| [run_action](#run-action) | `POST /v1/amadeus/conversations/{conversation_id}/actions/{action_id}/execute` |
| [run_action_stream](#run-action-stream) | `POST /v1/amadeus/conversations/{conversation_id}/actions/{action_id}/execute/stream` |
| [files_open_folder](#files-open-folder) | `POST /v1/amadeus/conversations/{conversation_id}/files/open-folder` |
| [import_file](#import-file) | `POST /v1/amadeus/conversations/{conversation_id}/imports` |
| [append_message](#append-message) | `POST /v1/amadeus/conversations/{conversation_id}/messages` |
| [answer_question](#answer-question) | `POST /v1/amadeus/conversations/{conversation_id}/questions/{question_id}/answer` |
| [create_run](#create-run) | `POST /v1/amadeus/conversations/{conversation_id}/runs` |
| [cancel_run](#cancel-run) | `POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/cancel` |
| [append_run_event](#append-run-event) | `POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/events` |
| [finish_run](#finish-run) | `POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/finish` |
| [heartbeat_run](#heartbeat-run) | `POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/heartbeat` |
| [pause_run_for_approval](#pause-run-for-approval) | `POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/pause-approval` |
| [create_question](#create-question) | `POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/question` |
| [skill_load](#skill-load) | `POST /v1/amadeus/conversations/{conversation_id}/skills/{skill_id}/load` |
| [model_turn](#model-turn) | `POST /v1/amadeus/model-turn` |
| [model_turn_stream](#model-turn-stream) | `POST /v1/amadeus/model-turn/stream` |
| [read_registered_operation](#read-registered-operation) | `POST /v1/amadeus/operations/read` |
| [file_write](#file-write) | `PUT /v1/amadeus/conversations/{conversation_id}/files/{kind}/{name}` |

## delete_conversation {#delete-conversation}

`client.amadeus.delete_conversation(...)`

**接口**：`DELETE /v1/amadeus/conversations/{conversation_id}`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
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

## list_conversations {#list-conversations}

`client.amadeus.list_conversations(...)`

**接口**：`GET /v1/amadeus/conversations`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ConversationListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_conversation {#get-conversation}

`client.amadeus.get_conversation(...)`

**接口**：`GET /v1/amadeus/conversations/{conversation_id}`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ConversationDetailOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## files_list {#files-list}

`client.amadeus.files_list(...)`

**接口**：`GET /v1/amadeus/conversations/{conversation_id}/files`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `FileListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## file_download {#file-download}

`client.amadeus.file_download(...)`

**接口**：`GET /v1/amadeus/conversations/{conversation_id}/files/{kind}/{name}`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `kind` | path | string | 是 |
| `name` | path | string | 是 |

**响应**：
- `200` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_runs {#list-runs}

`client.amadeus.list_runs(...)`

**接口**：`GET /v1/amadeus/conversations/{conversation_id}/runs`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_run {#get-run}

`client.amadeus.get_run(...)`

**接口**：`GET /v1/amadeus/conversations/{conversation_id}/runs/{run_id}`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `run_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `RunDetailOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## skill_file_read {#skill-file-read}

`client.amadeus.skill_file_read(...)`

**接口**：`GET /v1/amadeus/conversations/{conversation_id}/skills/{skill_id}/{version}/files/{relative_path}`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `skill_id` | path | string | 是 |
| `version` | path | string | 是 |
| `relative_path` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_registered_operations {#list-registered-operations}

`client.amadeus.list_registered_operations(...)`

**接口**：`GET /v1/amadeus/operations`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `resource` | query | string | 否 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## active_run {#active-run}

`client.amadeus.active_run(...)`

**接口**：`GET /v1/amadeus/runs/active`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `RunDetailOut / null`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## script_capability {#script-capability}

`client.amadeus.script_capability(...)`

**接口**：`GET /v1/amadeus/script-capability`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_conversation {#patch-conversation}

`client.amadeus.patch_conversation(...)`

**接口**：`PATCH /v1/amadeus/conversations/{conversation_id}`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `body` | application/json | ConversationPatchIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.model_id` | 请求体 | string / null | 否 |
| `body.title` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `ConversationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_conversation {#create-conversation}

`client.amadeus.create_conversation(...)`

**接口**：`POST /v1/amadeus/conversations`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ConversationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## propose_action {#propose-action}

`client.amadeus.propose_action(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/actions`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `body` | application/json | ActionIn | 是 |
| `body.arguments` | 请求体 | object | 否 |
| `body.run_id` | 请求体 | string / null | 否 |
| `body.tool_name` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ActionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## stop_action {#stop-action}

`client.amadeus.stop_action(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/actions/{action_id}/cancel`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `action_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ActionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## decide_action {#decide-action}

`client.amadeus.decide_action(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/actions/{action_id}/decision`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `action_id` | path | string | 是 |
| `body` | application/json | ActionDecisionIn | 是 |
| `body.approve` | 请求体 | boolean | 是 |
| `body.arguments_sha256` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ActionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## run_action {#run-action}

`client.amadeus.run_action(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/actions/{action_id}/execute`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `action_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ActionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## run_action_stream {#run-action-stream}

`client.amadeus.run_action_stream(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/actions/{action_id}/execute/stream`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `action_id` | path | string | 是 |

**响应**：
- `200` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## files_open_folder {#files-open-folder}

`client.amadeus.files_open_folder(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/files/open-folder`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_file {#import-file}

`client.amadeus.import_file(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/imports`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `body` | multipart/form-data | Body_import_file_v1_amadeus_conversations__conversation_id__imports_post | 是 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `FileOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## append_message {#append-message}

`client.amadeus.append_message(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/messages`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `body` | application/json | MessageIn | 是 |
| `body.content` | 请求体 | string | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.references` | 请求体 | array | 否 |
| `body.role` | 请求体 | user / assistant / tool | 是 |

**响应**：
- `200` · `application/json` · `ConversationDetailOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## answer_question {#answer-question}

`client.amadeus.answer_question(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/questions/{question_id}/answer`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `question_id` | path | string | 是 |
| `body` | application/json | QuestionAnswerIn | 是 |
| `body.answer` | 请求体 | string | 是 |
| `body.note` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `QuestionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_run {#create-run}

`client.amadeus.create_run(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/runs`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `body` | application/json | RunCreateIn | 是 |
| `body.agent_id` | 请求体 | codex / claude-code | 是 |
| `body.agent_model` | 请求体 | string | 否 |
| `body.capabilities` | 请求体 | array | 否 |
| `body.context` | 请求体 | array | 否 |
| `body.mode` | 请求体 | agent / plan | 否 |
| `body.model_id` | 请求体 | string | 否 |
| `body.references` | 请求体 | array | 否 |
| `body.source_run_id` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `RunDetailOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cancel_run {#cancel-run}

`client.amadeus.cancel_run(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/cancel`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `run_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `RunDetailOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## append_run_event {#append-run-event}

`client.amadeus.append_run_event(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/events`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `run_id` | path | string | 是 |
| `body` | application/json | RunEventIn | 是 |
| `body.idempotency_key` | 请求体 | string | 是 |
| `body.kind` | 请求体 | assistant_delta / assistant_message / tool_call / tool_result / status / error / question / subagent_start / subagent_finish | 是 |
| `body.payload` | 请求体 | object | 否 |

**响应**：
- `200` · `application/json` · `RunEventOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## finish_run {#finish-run}

`client.amadeus.finish_run(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/finish`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `run_id` | path | string | 是 |
| `body` | application/json | RunFinishIn | 是 |
| `body.error_message` | 请求体 | string / null | 否 |
| `body.status` | 请求体 | completed / failed / cancelled / interrupted | 是 |

**响应**：
- `200` · `application/json` · `RunDetailOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## heartbeat_run {#heartbeat-run}

`client.amadeus.heartbeat_run(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/heartbeat`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `run_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `RunOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## pause_run_for_approval {#pause-run-for-approval}

`client.amadeus.pause_run_for_approval(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/pause-approval`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `run_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `RunDetailOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_question {#create-question}

`client.amadeus.create_question(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/runs/{run_id}/question`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `run_id` | path | string | 是 |
| `body` | application/json | QuestionIn | 是 |
| `body.allow_text` | 请求体 | boolean | 否 |
| `body.options` | 请求体 | array | 否 |
| `body.prompt` | 请求体 | string | 是 |
| `body.tool_call_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `QuestionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## skill_load {#skill-load}

`client.amadeus.skill_load(...)`

**接口**：`POST /v1/amadeus/conversations/{conversation_id}/skills/{skill_id}/load`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `skill_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## model_turn {#model-turn}

`client.amadeus.model_turn(...)`

**接口**：`POST /v1/amadeus/model-turn`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ModelTurnIn | 是 |
| `body.messages` | 请求体 | array | 是 |
| `body.model_id` | 请求体 | string | 是 |
| `body.run_id` | 请求体 | string / null | 否 |
| `body.subagent_id` | 请求体 | string / null | 否 |
| `body.system` | 请求体 | string | 是 |
| `body.tools` | 请求体 | array | 否 |

**响应**：
- `200` · `application/json` · `ModelTurnOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## model_turn_stream {#model-turn-stream}

`client.amadeus.model_turn_stream(...)`

**接口**：`POST /v1/amadeus/model-turn/stream`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ModelTurnIn | 是 |
| `body.messages` | 请求体 | array | 是 |
| `body.model_id` | 请求体 | string | 是 |
| `body.run_id` | 请求体 | string / null | 否 |
| `body.subagent_id` | 请求体 | string / null | 否 |
| `body.system` | 请求体 | string | 是 |
| `body.tools` | 请求体 | array | 否 |

**响应**：
- `200` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## read_registered_operation {#read-registered-operation}

`client.amadeus.read_registered_operation(...)`

**接口**：`POST /v1/amadeus/operations/read`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | object | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## file_write {#file-write}

`client.amadeus.file_write(...)`

**接口**：`PUT /v1/amadeus/conversations/{conversation_id}/files/{kind}/{name}`。**鉴权**：仅桌面模式；浏览器 Session；桌面私有传输校验；不接受 Management API Key。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `conversation_id` | path | string | 是 |
| `kind` | path | string | 是 |
| `name` | path | string | 是 |
| `body` | application/json | FileWriteIn | 是 |
| `body.content` | 请求体 | string | 是 |
| `body.expected_sha256` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `FileOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
