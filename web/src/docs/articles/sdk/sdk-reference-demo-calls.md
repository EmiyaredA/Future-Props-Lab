<!-- docs: {"group": "api-modules", "category": "api", "order": 8, "title": "演示服务调用方法参考", "lead": "client.demo_calls 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 演示服务调用方法参考

通过 `client.demo_calls` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [example_tool](#example-tool) | `GET /v1/demo-services/tools/{tool}` |
| [mock_completion](#mock-completion) | `POST /v1/demo-services/model/chat/completions` |

## example_tool {#example-tool}

`client.demo_calls.example_tool(...)`

**接口**：`GET /v1/demo-services/tools/{tool}`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `tool` | path | string | 是 |
| `q` | query | string | 否 |
| `id` | query | string | 否 |
| `order_id` | query | string | 否 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## mock_completion {#mock-completion}

`client.demo_calls.mock_completion(...)`

**接口**：`POST /v1/demo-services/model/chat/completions`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | MockCompletionIn | 是 |
| `body.messages` | 请求体 | array | 否 |
| `body.model` | 请求体 | string | 否 |
| `body.stream` | 请求体 | boolean | 否 |
| `body.tool_choice` | 请求体 | string / object / null | 否 |
| `body.tools` | 请求体 | array | 否 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
