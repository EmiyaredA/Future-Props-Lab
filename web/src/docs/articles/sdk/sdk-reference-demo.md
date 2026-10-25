<!-- docs: {"group": "api-modules", "category": "api", "order": 6, "title": "演示服务管理方法参考", "lead": "client.demo 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 演示服务管理方法参考

通过 `client.demo` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [services](#services) | `GET /v1/platform/demo-services` |
| [install](#install) | `POST /v1/account/demo-services/{service_id}/install` |
| [action](#action) | `POST /v1/platform/demo-services/{service_id}/actions` |
| [configuration](#configuration) | `PUT /v1/platform/demo-services/{service_id}` |

## services {#services}

`client.demo.services(...)`

**接口**：`GET /v1/platform/demo-services`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## install {#install}

`client.demo.install(...)`

**接口**：`POST /v1/account/demo-services/{service_id}/install`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `service_id` | path | mock_model / example_tools | 是 |
| `body` | application/json | DemoInstallIn | 是 |
| `body.expected_catalog_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `DemoInstallOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## action {#action}

`client.demo.action(...)`

**接口**：`POST /v1/platform/demo-services/{service_id}/actions`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `service_id` | path | mock_model / example_tools | 是 |
| `body` | application/json | DemoActionIn | 是 |
| `body.action` | 请求体 | start / stop / reinitialize | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `DemoServiceOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## configuration {#configuration}

`client.demo.configuration(...)`

**接口**：`PUT /v1/platform/demo-services/{service_id}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `service_id` | path | mock_model / example_tools | 是 |
| `body` | application/json | DemoConfigIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.value` | 请求体 | DemoConfig | 是 |

**响应**：
- `200` · `application/json` · `DemoServiceOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
