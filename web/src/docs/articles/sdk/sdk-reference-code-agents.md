<!-- docs: {"group": "api-modules", "category": "api", "order": 5, "title": "编程智能体连接方法参考", "lead": "client.code_agents 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 编程智能体连接方法参考

通过 `client.code_agents` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [list_code_agents](#list-code-agents) | `GET /v1/code-agents` |
| [detect_code_agents](#detect-code-agents) | `POST /v1/code-agents/detect` |
| [enable_code_agent](#enable-code-agent) | `POST /v1/code-agents/{agent_id}/enable` |

## list_code_agents {#list-code-agents}

`client.code_agents.list_code_agents(...)`

**接口**：`GET /v1/code-agents`。**鉴权**：浏览器 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `CatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## detect_code_agents {#detect-code-agents}

`client.code_agents.detect_code_agents(...)`

**接口**：`POST /v1/code-agents/detect`。**鉴权**：浏览器 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `CatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## enable_code_agent {#enable-code-agent}

`client.code_agents.enable_code_agent(...)`

**接口**：`POST /v1/code-agents/{agent_id}/enable`。**鉴权**：可信本机管理员 Session；需要近期密码重验。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `agent_id` | path | codex / claude-code / opencode / dsh / pi | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
