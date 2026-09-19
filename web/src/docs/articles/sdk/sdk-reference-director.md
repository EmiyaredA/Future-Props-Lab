<!-- docs: {"group": "api-modules", "category": "api", "order": 6, "title": "导演台方法参考", "lead": "client.director 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 导演台方法参考

通过 `client.director` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_motion](#delete-motion) | `DELETE /v1/director-desk/motions/{motion_key}` |
| [delete_project](#delete-project) | `DELETE /v1/director-desk/projects/{project_id}` |
| [release_agent_session](#release-agent-session) | `DELETE /v1/director-desk/projects/{project_id}/agent-session` |
| [download_library_file](#download-library-file) | `GET /v1/director-desk/library/files/{key}` |
| [list_motions](#list-motions) | `GET /v1/director-desk/motions` |
| [get_motion](#get-motion) | `GET /v1/director-desk/motions/{motion_key}` |
| [list_projects](#list-projects) | `GET /v1/director-desk/projects` |
| [get_project](#get-project) | `GET /v1/director-desk/projects/{project_id}` |
| [poll_agent_session](#poll-agent-session) | `GET /v1/director-desk/projects/{project_id}/agent-session/calls` |
| [download_project_file](#download-project-file) | `GET /v1/director-desk/projects/{project_id}/files/{key}` |
| [patch_project](#patch-project) | `PATCH /v1/director-desk/projects/{project_id}` |
| [upload_library_file](#upload-library-file) | `POST /v1/director-desk/library/files` |
| [create_project](#create-project) | `POST /v1/director-desk/projects` |
| [claim_agent_session](#claim-agent-session) | `POST /v1/director-desk/projects/{project_id}/agent-session` |
| [complete_agent_call](#complete-agent-call) | `POST /v1/director-desk/projects/{project_id}/agent-session/calls/{call_id}` |
| [upload_project_file](#upload-project-file) | `POST /v1/director-desk/projects/{project_id}/files` |
| [call_tool](#call-tool) | `POST /v1/director-desk/projects/{project_id}/tools` |
| [save_motion](#save-motion) | `PUT /v1/director-desk/motions/{motion_key}` |

## delete_motion {#delete-motion}

`client.director.delete_motion(...)`

**接口**：`DELETE /v1/director-desk/motions/{motion_key}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `motion_key` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_project {#delete-project}

`client.director.delete_project(...)`

**接口**：`DELETE /v1/director-desk/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## release_agent_session {#release-agent-session}

`client.director.release_agent_session(...)`

**接口**：`DELETE /v1/director-desk/projects/{project_id}/agent-session`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `session_id` | query | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_library_file {#download-library-file}

`client.director.download_library_file(...)`

**接口**：`GET /v1/director-desk/library/files/{key}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `key` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_motions {#list-motions}

`client.director.list_motions(...)`

**接口**：`GET /v1/director-desk/motions`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `query` | query | string | 否 |

**响应**：
- `200` · `application/json` · `DirectorMotionList`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_motion {#get-motion}

`client.director.get_motion(...)`

**接口**：`GET /v1/director-desk/motions/{motion_key}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `motion_key` | path | string | 是 |

**响应**：
- `200` · `application/json` · `DirectorMotionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_projects {#list-projects}

`client.director.list_projects(...)`

**接口**：`GET /v1/director-desk/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `query` | query | string | 否 |
| `offset` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `DirectorProjectList`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.director.get_project(...)`

**接口**：`GET /v1/director-desk/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `DirectorProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## poll_agent_session {#poll-agent-session}

`client.director.poll_agent_session(...)`

**接口**：`GET /v1/director-desk/projects/{project_id}/agent-session/calls`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `session_id` | query | string | 是 |
| `wait` | query | number | 否 |

**响应**：
- `200` · `application/json` · `DirectorAgentPollOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_project_file {#download-project-file}

`client.director.download_project_file(...)`

**接口**：`GET /v1/director-desk/projects/{project_id}/files/{key}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `key` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_project {#patch-project}

`client.director.patch_project(...)`

**接口**：`PATCH /v1/director-desk/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | DirectorProjectPatch | 是 |
| `body.document` | 请求体 | DirectorDocument / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `DirectorProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_library_file {#upload-library-file}

`client.director.upload_library_file(...)`

**接口**：`POST /v1/director-desk/library/files`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_upload_library_file_v1_director_desk_library_files_post | 是 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `DirectorFileOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.director.create_project(...)`

**接口**：`POST /v1/director-desk/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | DirectorProjectCreate | 是 |
| `body.title` | 请求体 | string | 否 |

**响应**：
- `201` · `application/json` · `DirectorProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## claim_agent_session {#claim-agent-session}

`client.director.claim_agent_session(...)`

**接口**：`POST /v1/director-desk/projects/{project_id}/agent-session`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `DirectorAgentSessionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## complete_agent_call {#complete-agent-call}

`client.director.complete_agent_call(...)`

**接口**：`POST /v1/director-desk/projects/{project_id}/agent-session/calls/{call_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `call_id` | path | string | 是 |
| `body` | application/json | DirectorAgentCallComplete | 是 |
| `body.error` | 请求体 | string / null | 否 |
| `body.result` | 请求体 | object | 否 |
| `body.session_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_project_file {#upload-project-file}

`client.director.upload_project_file(...)`

**接口**：`POST /v1/director-desk/projects/{project_id}/files`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_project_file_v1_director_desk_projects__project_id__files_post | 是 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `DirectorFileOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## call_tool {#call-tool}

`client.director.call_tool(...)`

**接口**：`POST /v1/director-desk/projects/{project_id}/tools`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | DirectorToolCall | 是 |
| `body.arguments` | 请求体 | object | 否 |
| `body.name` | 请求体 | string | 是 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `DirectorToolOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## save_motion {#save-motion}

`client.director.save_motion(...)`

**接口**：`PUT /v1/director-desk/motions/{motion_key}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `motion_key` | path | string | 是 |
| `body` | application/json | DirectorMotionWrite | 是 |
| `body.motion` | 请求体 | object | 是 |
| `body.resource` | 请求体 | object | 是 |

**响应**：
- `200` · `application/json` · `DirectorMotionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
