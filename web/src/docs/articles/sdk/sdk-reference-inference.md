<!-- docs: {"group": "api-modules", "category": "api", "order": 12, "title": "独立模型调用方法参考", "lead": "client.inference 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 独立模型调用方法参考

通过 `client.inference` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_asset](#delete-asset) | `DELETE /v1/model-inference/assets/{asset_id}` |
| [delete_task](#delete-task) | `DELETE /v1/model-inference/tasks/{task_id}` |
| [model_options](#model-options) | `GET /v1/model-inference/options` |
| [list_tasks](#list-tasks) | `GET /v1/model-inference/tasks` |
| [get_task](#get-task) | `GET /v1/model-inference/tasks/{task_id}` |
| [download_result](#download-result) | `GET /v1/model-inference/tasks/{task_id}/content` |
| [upload_asset](#upload-asset) | `POST /v1/model-inference/assets` |
| [import_asset](#import-asset) | `POST /v1/model-inference/assets/import` |
| [create_task](#create-task) | `POST /v1/model-inference/tasks` |
| [retry_materialization](#retry-materialization) | `POST /v1/model-inference/tasks/{task_id}/retry-materialization` |
| [save_result](#save-result) | `POST /v1/model-inference/tasks/{task_id}/save-to-library` |
| [generate_text](#generate-text) | `POST /v1/model-inference/text` |
| [stream_text](#stream-text) | `POST /v1/model-inference/text/stream` |

## delete_asset {#delete-asset}

`client.inference.delete_asset(...)`

**接口**：`DELETE /v1/model-inference/assets/{asset_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `asset_id` | path | string | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_task {#delete-task}

`client.inference.delete_task(...)`

**接口**：`DELETE /v1/model-inference/tasks/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## model_options {#model-options}

`client.inference.model_options(...)`

**接口**：`GET /v1/model-inference/options`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `InferenceOptionsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_tasks {#list-tasks}

`client.inference.list_tasks(...)`

**接口**：`GET /v1/model-inference/tasks`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `offset` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `InferenceTasksOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_task {#get-task}

`client.inference.get_task(...)`

**接口**：`GET /v1/model-inference/tasks/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `InferenceTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_result {#download-result}

`client.inference.download_result(...)`

**接口**：`GET /v1/model-inference/tasks/{task_id}/content`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/octet-stream` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_asset {#upload-asset}

`client.inference.upload_asset(...)`

**接口**：`POST /v1/model-inference/assets`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_upload_asset_v1_model_inference_assets_post | 是 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `InferenceAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_asset {#import-asset}

`client.inference.import_asset(...)`

**接口**：`POST /v1/model-inference/assets/import`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | InferenceAssetImportIn | 是 |
| `body.asset_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `InferenceAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_task {#create-task}

`client.inference.create_task(...)`

**接口**：`POST /v1/model-inference/tasks`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | InferenceTaskIn | 是 |
| `body.asset_ids` | 请求体 | array | 否 |
| `body.kind` | 请求体 | image / video / music / sound_effect / transcription | 是 |
| `body.model_id` | 请求体 | string | 是 |
| `body.parameters` | 请求体 | object | 否 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `InferenceTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## retry_materialization {#retry-materialization}

`client.inference.retry_materialization(...)`

**接口**：`POST /v1/model-inference/tasks/{task_id}/retry-materialization`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |
| `body` | application/json | InferenceRevisionIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `InferenceTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## save_result {#save-result}

`client.inference.save_result(...)`

**接口**：`POST /v1/model-inference/tasks/{task_id}/save-to-library`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VisualAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## generate_text {#generate-text}

`client.inference.generate_text(...)`

**接口**：`POST /v1/model-inference/text`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | InferenceTextIn | 是 |
| `body.max_tokens` | 请求体 | integer | 否 |
| `body.messages` | 请求体 | array | 是 |
| `body.model_id` | 请求体 | string | 是 |
| `body.system_prompt` | 请求体 | string | 否 |
| `body.temperature` | 请求体 | number | 否 |

**响应**：
- `200` · `application/json` · `InferenceTextOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## stream_text {#stream-text}

`client.inference.stream_text(...)`

**接口**：`POST /v1/model-inference/text/stream`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | InferenceTextIn | 是 |
| `body.max_tokens` | 请求体 | integer | 否 |
| `body.messages` | 请求体 | array | 是 |
| `body.model_id` | 请求体 | string | 是 |
| `body.system_prompt` | 请求体 | string | 否 |
| `body.temperature` | 请求体 | number | 否 |

**响应**：
- `200` · `application/json` · `object`
- `200` · `text/event-stream` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
