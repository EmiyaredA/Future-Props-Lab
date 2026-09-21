<!-- docs: {"group": "api-modules", "category": "api", "order": 22, "title": "测试工具方法参考", "lead": "client.test_tools 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 测试工具方法参考

通过 `client.test_tools` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_tool](#delete-tool) | `DELETE /v1/model-test/tools/{tool_id}` |
| [list_tools](#list-tools) | `GET /v1/model-test/tools` |
| [get_tool](#get-tool) | `GET /v1/model-test/tools/{tool_id}` |
| [update_tool](#update-tool) | `PATCH /v1/model-test/tools/{tool_id}` |
| [create_tool](#create-tool) | `POST /v1/model-test/tools` |
| [execute_tool](#execute-tool) | `POST /v1/model-test/tools/{tool_id}/execute` |

## delete_tool {#delete-tool}

`client.test_tools.delete_tool(...)`

**接口**：`DELETE /v1/model-test/tools/{tool_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `tool_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_tools {#list-tools}

`client.test_tools.list_tools(...)`

**接口**：`GET /v1/model-test/tools`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ModelTestToolCatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_tool {#get-tool}

`client.test_tools.get_tool(...)`

**接口**：`GET /v1/model-test/tools/{tool_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `tool_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ModelTestToolOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_tool {#update-tool}

`client.test_tools.update_tool(...)`

**接口**：`PATCH /v1/model-test/tools/{tool_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `tool_id` | path | string | 是 |
| `body` | application/json | ModelTestToolPatchIn | 是 |
| `body.delay_ms` | 请求体 | integer | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.error_code` | 请求体 | string | 否 |
| `body.error_message` | 请求体 | string | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.input_schema` | 请求体 | object | 否 |
| `body.mock_kind` | 请求体 | success / failure | 否 |
| `body.mock_result` | 请求体 | object | 否 |
| `body.name` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ModelTestToolOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_tool {#create-tool}

`client.test_tools.create_tool(...)`

**接口**：`POST /v1/model-test/tools`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ModelTestToolCreateIn | 是 |
| `body.delay_ms` | 请求体 | integer | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.error_code` | 请求体 | string | 否 |
| `body.error_message` | 请求体 | string | 否 |
| `body.input_schema` | 请求体 | object | 否 |
| `body.mock_kind` | 请求体 | success / failure | 否 |
| `body.mock_result` | 请求体 | object | 否 |
| `body.name` | 请求体 | string | 是 |

**响应**：
- `201` · `application/json` · `ModelTestToolOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## execute_tool {#execute-tool}

`client.test_tools.execute_tool(...)`

**接口**：`POST /v1/model-test/tools/{tool_id}/execute`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `tool_id` | path | string | 是 |
| `body` | application/json | ModelTestToolExecuteIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.input` | 请求体 | object | 否 |

**响应**：
- `200` · `application/json` · `ModelTestToolCallOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
