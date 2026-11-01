<!-- docs: {"group": "api-modules", "category": "api", "order": 5, "title": "编程智能体连接与授权方法参考", "lead": "client.code_agents 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 编程智能体连接与授权方法参考

通过 `client.code_agents` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [list_code_agents](#list-code-agents) | `GET /v1/code-agents` |
| [get_code_agent_grants](#get-code-agent-grants) | `GET /v1/code-agents/grants` |
| [detect_code_agents](#detect-code-agents) | `POST /v1/code-agents/detect` |
| [put_code_agent_grants](#put-code-agent-grants) | `PUT /v1/code-agents/grants` |

## list_code_agents {#list-code-agents}

`client.code_agents.list_code_agents(...)`

**接口**：`GET /v1/code-agents`。**鉴权**：浏览器 Session；连接授权管理须平台管理员并满足近期密码验证要求。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `CatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_code_agent_grants {#get-code-agent-grants}

`client.code_agents.get_code_agent_grants(...)`

**接口**：`GET /v1/code-agents/grants`。**鉴权**：浏览器 Session；连接授权管理须平台管理员并满足近期密码验证要求。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `GrantsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## detect_code_agents {#detect-code-agents}

`client.code_agents.detect_code_agents(...)`

**接口**：`POST /v1/code-agents/detect`。**鉴权**：浏览器 Session；连接授权管理须平台管理员并满足近期密码验证要求。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `CatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_code_agent_grants {#put-code-agent-grants}

`client.code_agents.put_code_agent_grants(...)`

**接口**：`PUT /v1/code-agents/grants`。**鉴权**：浏览器 Session；连接授权管理须平台管理员并满足近期密码验证要求。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | GrantUpdate | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.grants` | 请求体 | array | 是 |
| `body.managed` | 请求体 | array | 是 |

**响应**：
- `200` · `application/json` · `GrantsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
