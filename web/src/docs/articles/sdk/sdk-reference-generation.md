<!-- docs: {"group": "api-modules", "category": "api", "order": 9, "title": "工坊生成任务方法参考", "lead": "client.generation 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 工坊生成任务方法参考

通过 `client.generation` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [list_generation_batches](#list-generation-batches) | `GET /v1/visual-workshop/generation-batches` |
| [get_generation_batch](#get-generation-batch) | `GET /v1/visual-workshop/generation-batches/{batch_id}` |
| [generation_options](#generation-options) | `GET /v1/visual-workshop/generation-options` |
| [list_generation_tasks](#list-generation-tasks) | `GET /v1/visual-workshop/generation-tasks` |
| [get_generation_task](#get-generation-task) | `GET /v1/visual-workshop/generation-tasks/{task_id}` |
| [retry_image_composition](#retry-image-composition) | `POST /v1/visual-workshop/generation-batches/{batch_id}/retry-composition` |
| [retry_materialization](#retry-materialization) | `POST /v1/visual-workshop/generation-tasks/{task_id}/retry-materialization` |
| [create_generation_batch](#create-generation-batch) | `POST /v1/visual-workshop/projects/{project_id}/generation-batches` |
| [create_generation_task](#create-generation-task) | `POST /v1/visual-workshop/projects/{project_id}/generation-tasks` |
| [create_image_composition](#create-image-composition) | `POST /v1/visual-workshop/projects/{project_id}/image-compositions` |

## list_generation_batches {#list-generation-batches}

`client.generation.list_generation_batches(...)`

**接口**：`GET /v1/visual-workshop/generation-batches`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | query | string / null | 否 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `GenerationBatchListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_generation_batch {#get-generation-batch}

`client.generation.get_generation_batch(...)`

**接口**：`GET /v1/visual-workshop/generation-batches/{batch_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `batch_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GenerationBatchOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## generation_options {#generation-options}

`client.generation.generation_options(...)`

**接口**：`GET /v1/visual-workshop/generation-options`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `GenerationOptionsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_generation_tasks {#list-generation-tasks}

`client.generation.list_generation_tasks(...)`

**接口**：`GET /v1/visual-workshop/generation-tasks`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | query | string / null | 否 |
| `canvas_node_id` | query | string / null | 否 |
| `kind` | query | image / video / audio / null | 否 |
| `status` | query | queued / submitting / pending / processing / completed / failed / null | 否 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `GenerationTaskListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_generation_task {#get-generation-task}

`client.generation.get_generation_task(...)`

**接口**：`GET /v1/visual-workshop/generation-tasks/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GenerationTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## retry_image_composition {#retry-image-composition}

`client.generation.retry_image_composition(...)`

**接口**：`POST /v1/visual-workshop/generation-batches/{batch_id}/retry-composition`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `batch_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GenerationBatchOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## retry_materialization {#retry-materialization}

`client.generation.retry_materialization(...)`

**接口**：`POST /v1/visual-workshop/generation-tasks/{task_id}/retry-materialization`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GenerationTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_generation_batch {#create-generation-batch}

`client.generation.create_generation_batch(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/generation-batches`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | ImageGenerationBatchCreateIn | 是 |
| `body.canvas_node_id` | 请求体 | string / null | 否 |
| `body.expected_canvas_revision` | 请求体 | integer / null | 否 |
| `body.grid_output` | 请求体 | nodes / composite | 否 |
| `body.grid_size` | 请求体 | 4 / 9 | 是 |
| `body.model_id` | 请求体 | string | 是 |
| `body.prompt` | 请求体 | string | 是 |
| `body.reference_asset_id` | 请求体 | string / null | 否 |
| `body.seed` | 请求体 | integer / null | 否 |
| `body.size` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `GenerationBatchOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_generation_task {#create-generation-task}

`client.generation.create_generation_task(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/generation-tasks`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | ImageGenerationTaskCreateIn / VideoGenerationTaskCreateIn / AudioGenerationTaskCreateIn | 是 |

**响应**：
- `200` · `application/json` · `GenerationTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_image_composition {#create-image-composition}

`client.generation.create_image_composition(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/image-compositions`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | ImageCompositionCreateIn | 是 |
| `body.expected_canvas_revision` | 请求体 | integer | 是 |
| `body.grid_size` | 请求体 | 4 / 9 | 是 |
| `body.items` | 请求体 | array | 是 |
| `body.result_position` | 请求体 | VisualCanvasPosition | 是 |
| `body.title` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `GenerationBatchOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
