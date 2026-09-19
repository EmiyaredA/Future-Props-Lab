<!-- docs: {"group": "api-modules", "category": "api", "order": 19, "title": "模型模板方法参考", "lead": "client.templates 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 模型模板方法参考

通过 `client.templates` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [job](#job) | `GET /v1/platform/model-service-templates/sync-jobs/{job_id}` |
| [template](#template) | `GET /v1/platform/model-service-templates/{role}` |
| [history](#history) | `GET /v1/platform/model-service-templates/{role}/sync-jobs` |
| [start](#start) | `POST /v1/platform/model-service-templates/sync-jobs/{job_id}/start` |
| [preview](#preview) | `POST /v1/platform/model-service-templates/{role}/preview` |
| [put_template](#put-template) | `PUT /v1/platform/model-service-templates/{role}` |

## job {#job}

`client.templates.job(...)`

**接口**：`GET /v1/platform/model-service-templates/sync-jobs/{job_id}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `job_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `TemplateSyncJobOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## template {#template}

`client.templates.template(...)`

**接口**：`GET /v1/platform/model-service-templates/{role}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `role` | path | super_admin / admin / member | 是 |

**响应**：
- `200` · `application/json` · `RoleModelTemplateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## history {#history}

`client.templates.history(...)`

**接口**：`GET /v1/platform/model-service-templates/{role}/sync-jobs`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `role` | path | super_admin / admin / member | 是 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## start {#start}

`client.templates.start(...)`

**接口**：`POST /v1/platform/model-service-templates/sync-jobs/{job_id}/start`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `job_id` | path | string | 是 |
| `body` | application/json | TemplateSyncIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `TemplateSyncJobOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview {#preview}

`client.templates.preview(...)`

**接口**：`POST /v1/platform/model-service-templates/{role}/preview`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `role` | path | super_admin / admin / member | 是 |
| `body` | application/json | TemplatePreviewIn | 是 |
| `body.expected_template_revision` | 请求体 | integer | 是 |

**响应**：
- `201` · `application/json` · `TemplateSyncJobOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_template {#put-template}

`client.templates.put_template(...)`

**接口**：`PUT /v1/platform/model-service-templates/{role}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `role` | path | super_admin / admin / member | 是 |
| `body` | application/json | RoleModelTemplateIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.value` | 请求体 | RoleModelTemplate-Input | 是 |

**响应**：
- `200` · `application/json` · `RoleModelTemplateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
