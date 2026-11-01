<!-- docs: {"group": "api-modules", "category": "api", "order": 4, "title": "网站自动化接入与资源定位方法参考", "lead": "client.automation 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 网站自动化接入与资源定位方法参考

通过 `client.automation` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [capabilities](#capabilities) | `GET /v1/automation/capabilities` |
| [changes](#changes) | `GET /v1/automation/changes` |
| [open_resource](#open-resource) | `POST /v1/automation/open` |

## capabilities {#capabilities}

`client.automation.capabilities(...)`

**接口**：`GET /v1/automation/capabilities`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `AutomationCapabilities`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## changes {#changes}

`client.automation.changes(...)`

**接口**：`GET /v1/automation/changes`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## open_resource {#open-resource}

`client.automation.open_resource(...)`

**接口**：`POST /v1/automation/open`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | AutomationOpenIn | 是 |
| `body.kind` | 请求体 | visual / galgame / video / presentation / annotation / director / note / knowledge / skill / tool-api / mcp | 是 |
| `body.resource_id` | 请求体 | string / null | 否 |
| `body.view` | 请求体 | list / details / upload / versions / tags / edit / validate / tools / null | 否 |

**响应**：
- `200` · `application/json` · `AutomationOpenOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
