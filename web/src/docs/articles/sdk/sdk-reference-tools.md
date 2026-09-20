<!-- docs: {"group": "api-modules", "category": "api", "order": 24, "title": "工具导航方法参考", "lead": "client.tools 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 工具导航方法参考

通过 `client.tools` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [get_state](#get-state) | `GET /v1/tool-navigation/state` |
| [set_favorite](#set-favorite) | `PATCH /v1/tool-navigation/tools/{tool_id}` |
| [record_use](#record-use) | `POST /v1/tool-navigation/tools/{tool_id}/use` |

## get_state {#get-state}

`client.tools.get_state(...)`

**接口**：`GET /v1/tool-navigation/state`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ToolNavigationStateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## set_favorite {#set-favorite}

`client.tools.set_favorite(...)`

**接口**：`PATCH /v1/tool-navigation/tools/{tool_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `tool_id` | path | string | 是 |
| `body` | application/json | ToolFavoriteIn | 是 |
| `body.is_favorite` | 请求体 | boolean | 是 |

**响应**：
- `200` · `application/json` · `ToolNavigationItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## record_use {#record-use}

`client.tools.record_use(...)`

**接口**：`POST /v1/tool-navigation/tools/{tool_id}/use`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `tool_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ToolNavigationItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
