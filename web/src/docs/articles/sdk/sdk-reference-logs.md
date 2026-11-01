<!-- docs: {"group": "api-modules", "category": "api", "order": 19, "title": "调用日志方法参考", "lead": "client.logs 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 调用日志方法参考

通过 `client.logs` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_one](#delete-one) | `DELETE /v1/llm-call-logs/{log_id}` |
| [list_logs](#list-logs) | `GET /v1/llm-call-logs` |
| [stats](#stats) | `GET /v1/llm-call-logs/stats` |
| [detail](#detail) | `GET /v1/llm-call-logs/{log_id}` |
| [reproduction_bundle](#reproduction-bundle) | `GET /v1/llm-call-logs/{log_id}/reproduction-bundle` |
| [batch_delete](#batch-delete) | `POST /v1/llm-call-logs/batch-delete` |

## delete_one {#delete-one}

`client.logs.delete_one(...)`

**接口**：`DELETE /v1/llm-call-logs/{log_id}`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `log_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_logs {#list-logs}

`client.logs.list_logs(...)`

**接口**：`GET /v1/llm-call-logs`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`logs.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `q` | query | string | 否 |
| `call_source` | query | string | 否 |
| `provider_kind` | query | string | 否 |
| `model` | query | string | 否 |
| `api_key_id` | query | string | 否 |
| `status` | query | string | 否 |
| `from` | query | string / null | 否 |
| `to` | query | string / null | 否 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `CallLogListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## stats {#stats}

`client.logs.stats(...)`

**接口**：`GET /v1/llm-call-logs/stats`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`logs.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `CallLogStatsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## detail {#detail}

`client.logs.detail(...)`

**接口**：`GET /v1/llm-call-logs/{log_id}`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`logs.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `log_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `CallLogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## reproduction_bundle {#reproduction-bundle}

`client.logs.reproduction_bundle(...)`

**接口**：`GET /v1/llm-call-logs/{log_id}/reproduction-bundle`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`logs.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `log_id` | path | string | 是 |

**响应**：
- `200` · `application/zip` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## batch_delete {#batch-delete}

`client.logs.batch_delete(...)`

**接口**：`POST /v1/llm-call-logs/batch-delete`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | BatchDeleteIn | 是 |
| `body.ids` | 请求体 | array | 否 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
