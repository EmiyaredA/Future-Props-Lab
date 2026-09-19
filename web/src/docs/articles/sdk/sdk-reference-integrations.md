<!-- docs: {"group": "api-modules", "category": "api", "order": 12, "title": "集成中心方法参考", "lead": "client.integrations 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 集成中心方法参考

通过 `client.integrations` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_mcp](#delete-mcp) | `DELETE /v1/integrations/mcp/{integration_id}` |
| [delete_skill](#delete-skill) | `DELETE /v1/integrations/skills/{skill_id}` |
| [delete_tool_api](#delete-tool-api) | `DELETE /v1/integrations/tool-apis/{integration_id}` |
| [mcp_servers](#mcp-servers) | `GET /v1/integrations/mcp` |
| [mcp_server](#mcp-server) | `GET /v1/integrations/mcp/{integration_id}` |
| [mcp_tools](#mcp-tools) | `GET /v1/integrations/mcp/{integration_id}/tools` |
| [skills](#skills) | `GET /v1/integrations/skills` |
| [skill](#skill) | `GET /v1/integrations/skills/{skill_id}` |
| [skill_versions](#skill-versions) | `GET /v1/integrations/skills/{skill_id}/versions` |
| [skill_version_content](#skill-version-content) | `GET /v1/integrations/skills/{skill_id}/versions/{version}/content` |
| [tool_apis](#tool-apis) | `GET /v1/integrations/tool-apis` |
| [tool_api](#tool-api) | `GET /v1/integrations/tool-apis/{integration_id}` |
| [update_mcp](#update-mcp) | `PATCH /v1/integrations/mcp/{integration_id}` |
| [update_skill](#update-skill) | `PATCH /v1/integrations/skills/{skill_id}` |
| [update_tool_api](#update-tool-api) | `PATCH /v1/integrations/tool-apis/{integration_id}` |
| [create_mcp](#create-mcp) | `POST /v1/integrations/mcp` |
| [validate_mcp](#validate-mcp) | `POST /v1/integrations/mcp/{integration_id}/validate` |
| [create_skill](#create-skill) | `POST /v1/integrations/skills` |
| [add_skill_version](#add-skill-version) | `POST /v1/integrations/skills/{skill_id}/versions` |
| [create_tool_api](#create-tool-api) | `POST /v1/integrations/tool-apis` |
| [validate_tool_api](#validate-tool-api) | `POST /v1/integrations/tool-apis/{integration_id}/validate` |

## delete_mcp {#delete-mcp}

`client.integrations.delete_mcp(...)`

**接口**：`DELETE /v1/integrations/mcp/{integration_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `integration_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `DeleteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_skill {#delete-skill}

`client.integrations.delete_skill(...)`

**接口**：`DELETE /v1/integrations/skills/{skill_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `skill_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `DeleteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_tool_api {#delete-tool-api}

`client.integrations.delete_tool_api(...)`

**接口**：`DELETE /v1/integrations/tool-apis/{integration_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `integration_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `DeleteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## mcp_servers {#mcp-servers}

`client.integrations.mcp_servers(...)`

**接口**：`GET /v1/integrations/mcp`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `McpCatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## mcp_server {#mcp-server}

`client.integrations.mcp_server(...)`

**接口**：`GET /v1/integrations/mcp/{integration_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `integration_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `McpOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## mcp_tools {#mcp-tools}

`client.integrations.mcp_tools(...)`

**接口**：`GET /v1/integrations/mcp/{integration_id}/tools`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `integration_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## skills {#skills}

`client.integrations.skills(...)`

**接口**：`GET /v1/integrations/skills`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `SkillCatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## skill {#skill}

`client.integrations.skill(...)`

**接口**：`GET /v1/integrations/skills/{skill_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `skill_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `SkillOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## skill_versions {#skill-versions}

`client.integrations.skill_versions(...)`

**接口**：`GET /v1/integrations/skills/{skill_id}/versions`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `skill_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## skill_version_content {#skill-version-content}

`client.integrations.skill_version_content(...)`

**接口**：`GET /v1/integrations/skills/{skill_id}/versions/{version}/content`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `skill_id` | path | string | 是 |
| `version` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## tool_apis {#tool-apis}

`client.integrations.tool_apis(...)`

**接口**：`GET /v1/integrations/tool-apis`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ToolApiCatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## tool_api {#tool-api}

`client.integrations.tool_api(...)`

**接口**：`GET /v1/integrations/tool-apis/{integration_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `integration_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ToolApiOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_mcp {#update-mcp}

`client.integrations.update_mcp(...)`

**接口**：`PATCH /v1/integrations/mcp/{integration_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `integration_id` | path | string | 是 |
| `body` | application/json | McpUpdateIn | 是 |
| `body.arguments` | 请求体 | array | 否 |
| `body.bearer_token` | 请求体 | string | 否 |
| `body.clear_bearer_token` | 请求体 | boolean | 否 |
| `body.clear_environment` | 请求体 | boolean | 否 |
| `body.command` | 请求体 | string | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.environment` | 请求体 | object | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.name` | 请求体 | string | 是 |
| `body.sensitive_result` | 请求体 | boolean | 否 |
| `body.tags` | 请求体 | array | 否 |
| `body.transport` | 请求体 | streamable_http / stdio | 否 |
| `body.url` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `McpOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_skill {#update-skill}

`client.integrations.update_skill(...)`

**接口**：`PATCH /v1/integrations/skills/{skill_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `skill_id` | path | string | 是 |
| `body` | application/json | SkillUpdateIn | 是 |
| `body.default_version` | 请求体 | string | 是 |
| `body.enabled` | 请求体 | boolean | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.tags` | 请求体 | array | 否 |

**响应**：
- `200` · `application/json` · `SkillOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_tool_api {#update-tool-api}

`client.integrations.update_tool_api(...)`

**接口**：`PATCH /v1/integrations/tool-apis/{integration_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `integration_id` | path | string | 是 |
| `body` | application/json | ToolApiUpdateIn | 是 |
| `body.auth_header_name` | 请求体 | string | 否 |
| `body.auth_kind` | 请求体 | none / bearer / api_key | 否 |
| `body.body_template` | 请求体 | object / null | 否 |
| `body.clear_secret` | 请求体 | boolean | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.method` | 请求体 | GET / POST / PUT / PATCH / DELETE | 否 |
| `body.name` | 请求体 | string | 是 |
| `body.parameters_schema` | 请求体 | object | 否 |
| `body.query_template` | 请求体 | object | 否 |
| `body.secret` | 请求体 | string | 否 |
| `body.sensitive_result` | 请求体 | boolean | 否 |
| `body.tags` | 请求体 | array | 否 |
| `body.url` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ToolApiOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_mcp {#create-mcp}

`client.integrations.create_mcp(...)`

**接口**：`POST /v1/integrations/mcp`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | McpCreateIn | 是 |
| `body.arguments` | 请求体 | array | 否 |
| `body.bearer_token` | 请求体 | string | 否 |
| `body.clear_bearer_token` | 请求体 | boolean | 否 |
| `body.clear_environment` | 请求体 | boolean | 否 |
| `body.command` | 请求体 | string | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.environment` | 请求体 | object | 否 |
| `body.name` | 请求体 | string | 是 |
| `body.sensitive_result` | 请求体 | boolean | 否 |
| `body.tags` | 请求体 | array | 否 |
| `body.transport` | 请求体 | streamable_http / stdio | 否 |
| `body.url` | 请求体 | string | 否 |

**响应**：
- `201` · `application/json` · `McpOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## validate_mcp {#validate-mcp}

`client.integrations.validate_mcp(...)`

**接口**：`POST /v1/integrations/mcp/{integration_id}/validate`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `integration_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `McpValidationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_skill {#create-skill}

`client.integrations.create_skill(...)`

**接口**：`POST /v1/integrations/skills`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_create_skill_v1_integrations_skills_post | 是 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.file` | 请求体 | string | 是 |
| `body.tags` | 请求体 | array / null | 否 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `201` · `application/json` · `SkillOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## add_skill_version {#add-skill-version}

`client.integrations.add_skill_version(...)`

**接口**：`POST /v1/integrations/skills/{skill_id}/versions`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `skill_id` | path | string | 是 |
| `body` | multipart/form-data | Body_add_skill_version_v1_integrations_skills__skill_id__versions_post | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `SkillOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_tool_api {#create-tool-api}

`client.integrations.create_tool_api(...)`

**接口**：`POST /v1/integrations/tool-apis`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ToolApiCreateIn | 是 |
| `body.auth_header_name` | 请求体 | string | 否 |
| `body.auth_kind` | 请求体 | none / bearer / api_key | 否 |
| `body.body_template` | 请求体 | object / null | 否 |
| `body.clear_secret` | 请求体 | boolean | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.method` | 请求体 | GET / POST / PUT / PATCH / DELETE | 否 |
| `body.name` | 请求体 | string | 是 |
| `body.parameters_schema` | 请求体 | object | 否 |
| `body.query_template` | 请求体 | object | 否 |
| `body.secret` | 请求体 | string | 否 |
| `body.sensitive_result` | 请求体 | boolean | 否 |
| `body.tags` | 请求体 | array | 否 |
| `body.url` | 请求体 | string | 是 |

**响应**：
- `201` · `application/json` · `ToolApiOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## validate_tool_api {#validate-tool-api}

`client.integrations.validate_tool_api(...)`

**接口**：`POST /v1/integrations/tool-apis/{integration_id}/validate`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `integration_id` | path | string | 是 |
| `body` | application/json | ToolApiValidateIn | 是 |
| `body.input` | 请求体 | object | 否 |

**响应**：
- `200` · `application/json` · `ToolApiValidationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
