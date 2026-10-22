<!-- docs: {"group": "api-modules", "category": "api", "order": 31, "title": "视觉助手方法参考", "lead": "client.visual_assistant 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 视觉助手方法参考

通过 `client.visual_assistant` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_conversation](#delete-conversation) | `DELETE /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}` |
| [list_conversations](#list-conversations) | `GET /v1/visual-workshop/projects/{project_id}/conversations` |
| [list_models](#list-models) | `GET /v1/visual-workshop/projects/{project_id}/conversations/models` |
| [get_conversation](#get-conversation) | `GET /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}` |
| [patch_conversation](#patch-conversation) | `PATCH /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}` |
| [create_conversation](#create-conversation) | `POST /v1/visual-workshop/projects/{project_id}/conversations` |
| [stream_message](#stream-message) | `POST /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}/messages/stream` |
| [resolve_approval](#resolve-approval) | `POST /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}/runs/{run_id}/approvals/{approval_id}` |

## delete_conversation {#delete-conversation}

`client.visual_assistant.delete_conversation(...)`

**接口**：`DELETE /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `conversation_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_conversations {#list-conversations}

`client.visual_assistant.list_conversations(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/conversations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VisualAssistantConversationListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_models {#list-models}

`client.visual_assistant.list_models(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/conversations/models`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VisualAssistantModelOptionListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_conversation {#get-conversation}

`client.visual_assistant.get_conversation(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `conversation_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VisualAssistantConversationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_conversation {#patch-conversation}

`client.visual_assistant.patch_conversation(...)`

**接口**：`PATCH /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `conversation_id` | path | string | 是 |
| `body` | application/json | VisualAssistantConversationPatchIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.image_model_id` | 请求体 | string / null | 否 |
| `body.model_id` | 请求体 | string / null | 否 |
| `body.title` | 请求体 | string / null | 否 |
| `body.video_model_id` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `VisualAssistantConversationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_conversation {#create-conversation}

`client.visual_assistant.create_conversation(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/conversations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VisualAssistantConversationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## stream_message {#stream-message}

`client.visual_assistant.stream_message(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}/messages/stream`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `conversation_id` | path | string | 是 |
| `body` | application/json | VisualAssistantSendIn | 是 |
| `body.asset_ids` | 请求体 | array | 否 |
| `body.canvas_revision` | 请求体 | integer | 是 |
| `body.content` | 请求体 | string | 否 |
| `body.content_parts` | 请求体 | array | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## resolve_approval {#resolve-approval}

`client.visual_assistant.resolve_approval(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}/runs/{run_id}/approvals/{approval_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `conversation_id` | path | string | 是 |
| `run_id` | path | string | 是 |
| `approval_id` | path | string | 是 |
| `body` | application/json | VisualAssistantApprovalIn | 是 |
| `body.canvas_revision` | 请求体 | integer | 是 |
| `body.decision` | 请求体 | approve / reject | 是 |

**响应**：
- `200` · `application/json` · `VisualAssistantApprovalOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
