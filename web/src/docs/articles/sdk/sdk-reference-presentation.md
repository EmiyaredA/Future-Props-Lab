<!-- docs: {"group": "api-modules", "category": "api", "order": 19, "title": "演示工坊方法参考", "lead": "client.presentation 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 演示工坊方法参考

通过 `client.presentation` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_project](#delete-project) | `DELETE /v1/presentation-workshop/projects/{project_id}` |
| [list_projects](#list-projects) | `GET /v1/presentation-workshop/projects` |
| [get_project](#get-project) | `GET /v1/presentation-workshop/projects/{project_id}` |
| [create_project](#create-project) | `POST /v1/presentation-workshop/projects` |
| [export_pptx](#export-pptx) | `POST /v1/presentation-workshop/projects/{project_id}/export` |
| [apply_presentation_operations](#apply-presentation-operations) | `POST /v1/presentation-workshop/projects/{project_id}/operations` |
| [put_project](#put-project) | `PUT /v1/presentation-workshop/projects/{project_id}` |

## delete_project {#delete-project}

`client.presentation.delete_project(...)`

**接口**：`DELETE /v1/presentation-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_projects {#list-projects}

`client.presentation.list_projects(...)`

**接口**：`GET /v1/presentation-workshop/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `query` | query | string | 否 |
| `offset` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `PresentationProjectList`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.presentation.get_project(...)`

**接口**：`GET /v1/presentation-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.presentation.create_project(...)`

**接口**：`POST /v1/presentation-workshop/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | PresentationProjectIn | 是 |
| `body.document` | 请求体 | PresentationDocument | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_pptx {#export-pptx}

`client.presentation.export_pptx(...)`

**接口**：`POST /v1/presentation-workshop/projects/{project_id}/export`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PresentationExportIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/vnd.openxmlformats-officedocument.presentationml.presentation` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_presentation_operations {#apply-presentation-operations}

`client.presentation.apply_presentation_operations(...)`

**接口**：`POST /v1/presentation-workshop/projects/{project_id}/operations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PresentationOperationsIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.operations` | 请求体 | array | 是 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_project {#put-project}

`client.presentation.put_project(...)`

**接口**：`PUT /v1/presentation-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PresentationProjectPut | 是 |
| `body.document` | 请求体 | PresentationDocument | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
