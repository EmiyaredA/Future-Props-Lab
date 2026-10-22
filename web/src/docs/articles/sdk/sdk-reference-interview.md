<!-- docs: {"group": "api-modules", "category": "api", "order": 16, "title": "面试资料准备方法参考", "lead": "client.interview 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 面试资料准备方法参考

通过 `client.interview` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_interview_room](#delete-interview-room) | `DELETE /v1/interview-assistant/rooms/{room_id}` |
| [get_interview_executor](#get-interview-executor) | `GET /v1/interview-assistant/executor` |
| [list_interview_rooms](#list-interview-rooms) | `GET /v1/interview-assistant/rooms` |
| [get_interview_room](#get-interview-room) | `GET /v1/interview-assistant/rooms/{room_id}` |
| [download_interview_material](#download-interview-material) | `GET /v1/interview-assistant/rooms/{room_id}/materials/{material_id}/download` |
| [get_interview_bundle](#get-interview-bundle) | `GET /v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/bundle` |
| [get_interview_progress](#get-interview-progress) | `GET /v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/events` |
| [export_interview_bundle](#export-interview-bundle) | `GET /v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/export` |
| [create_interview_room](#create-interview-room) | `POST /v1/interview-assistant/rooms` |
| [upload_interview_material](#upload-interview-material) | `POST /v1/interview-assistant/rooms/{room_id}/materials` |
| [prepare_interview](#prepare-interview) | `POST /v1/interview-assistant/rooms/{room_id}/preparations` |
| [cancel_interview_preparation](#cancel-interview-preparation) | `POST /v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/cancel` |

## delete_interview_room {#delete-interview-room}

`client.interview.delete_interview_room(...)`

**接口**：`DELETE /v1/interview-assistant/rooms/{room_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `room_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_interview_executor {#get-interview-executor}

`client.interview.get_interview_executor(...)`

**接口**：`GET /v1/interview-assistant/executor`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `InterviewExecutorOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_interview_rooms {#list-interview-rooms}

`client.interview.list_interview_rooms(...)`

**接口**：`GET /v1/interview-assistant/rooms`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `InterviewRoomList`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_interview_room {#get-interview-room}

`client.interview.get_interview_room(...)`

**接口**：`GET /v1/interview-assistant/rooms/{room_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `room_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `InterviewRoomOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_interview_material {#download-interview-material}

`client.interview.download_interview_material(...)`

**接口**：`GET /v1/interview-assistant/rooms/{room_id}/materials/{material_id}/download`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `room_id` | path | string | 是 |
| `material_id` | path | string | 是 |

**响应**：
- `200` · `application/octet-stream` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_interview_bundle {#get-interview-bundle}

`client.interview.get_interview_bundle(...)`

**接口**：`GET /v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/bundle`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `room_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `PreparationBundle`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_interview_progress {#get-interview-progress}

`client.interview.get_interview_progress(...)`

**接口**：`GET /v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/events`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `room_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `InterviewTaskProgress`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_interview_bundle {#export-interview-bundle}

`client.interview.export_interview_bundle(...)`

**接口**：`GET /v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/export`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `room_id` | path | string | 是 |
| `task_id` | path | string | 是 |
| `format` | query | string | 否 |

**响应**：
- `200` · `application/octet-stream` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_interview_room {#create-interview-room}

`client.interview.create_interview_room(...)`

**接口**：`POST /v1/interview-assistant/rooms`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | InterviewCreateIn | 是 |
| `body.request_id` | 请求体 | string | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `201` · `application/json` · `InterviewRoomOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_interview_material {#upload-interview-material}

`client.interview.upload_interview_material(...)`

**接口**：`POST /v1/interview-assistant/rooms/{room_id}/materials`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `room_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |
| `body` | multipart/form-data | Body_upload_interview_material_v1_interview_assistant_rooms__room_id__materials_post | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `InterviewRoomOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## prepare_interview {#prepare-interview}

`client.interview.prepare_interview(...)`

**接口**：`POST /v1/interview-assistant/rooms/{room_id}/preparations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `room_id` | path | string | 是 |
| `body` | application/json | InterviewPrepareIn | 是 |
| `body.duration` | 请求体 | 15 / 30 / 45 / 60 | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.jd` | 请求体 | string | 是 |
| `body.material_id` | 请求体 | string / null | 否 |
| `body.request_id` | 请求体 | string | 是 |
| `body.resume` | 请求体 | string | 否 |
| `body.role` | 请求体 | string | 是 |

**响应**：
- `202` · `application/json` · `InterviewRoomOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cancel_interview_preparation {#cancel-interview-preparation}

`client.interview.cancel_interview_preparation(...)`

**接口**：`POST /v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/cancel`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `room_id` | path | string | 是 |
| `task_id` | path | string | 是 |
| `body` | application/json | InterviewRevisionIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `InterviewRoomOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
