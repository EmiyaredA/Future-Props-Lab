<!-- docs: {"group": "api-modules", "category": "api", "order": 8, "title": "桌宠工坊方法参考", "lead": "client.desktop_pet 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 桌宠工坊方法参考

通过 `client.desktop_pet` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_project](#delete-project) | `DELETE /v1/desktop-pet/projects/{project_id}` |
| [clear_chat](#clear-chat) | `DELETE /v1/desktop-pet/projects/{project_id}/chat/messages` |
| [list_projects](#list-projects) | `GET /v1/desktop-pet/projects` |
| [get_project](#get-project) | `GET /v1/desktop-pet/projects/{project_id}` |
| [asset_file](#asset-file) | `GET /v1/desktop-pet/projects/{project_id}/assets/{asset_id}/file` |
| [get_chat](#get-chat) | `GET /v1/desktop-pet/projects/{project_id}/chat` |
| [chat_messages](#chat-messages) | `GET /v1/desktop-pet/projects/{project_id}/chat/messages` |
| [get_document](#get-document) | `GET /v1/desktop-pet/projects/{project_id}/document` |
| [patch_project](#patch-project) | `PATCH /v1/desktop-pet/projects/{project_id}` |
| [update_chat](#update-chat) | `PATCH /v1/desktop-pet/projects/{project_id}/chat` |
| [create_project](#create-project) | `POST /v1/desktop-pet/projects` |
| [import_whale](#import-whale) | `POST /v1/desktop-pet/projects/import-whale` |
| [send_chat_message](#send-chat-message) | `POST /v1/desktop-pet/projects/{project_id}/chat/messages/stream` |
| [sync_source](#sync-source) | `POST /v1/desktop-pet/projects/{project_id}/sync-source` |
| [save_document](#save-document) | `PUT /v1/desktop-pet/projects/{project_id}/document` |
| [upload_skin_replacement](#upload-skin-replacement) | `PUT /v1/desktop-pet/projects/{project_id}/skins/{skin_id}/replacements/{source_asset_id}` |

## delete_project {#delete-project}

`client.desktop_pet.delete_project(...)`

**接口**：`DELETE /v1/desktop-pet/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `expectedRevision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## clear_chat {#clear-chat}

`client.desktop_pet.clear_chat(...)`

**接口**：`DELETE /v1/desktop-pet/projects/{project_id}/chat/messages`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PetChatClearIn | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `PetChatOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_projects {#list-projects}

`client.desktop_pet.list_projects(...)`

**接口**：`GET /v1/desktop-pet/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `PetProjectsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.desktop_pet.get_project(...)`

**接口**：`GET /v1/desktop-pet/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `PetProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## asset_file {#asset-file}

`client.desktop_pet.asset_file(...)`

**接口**：`GET /v1/desktop-pet/projects/{project_id}/assets/{asset_id}/file`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `asset_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_chat {#get-chat}

`client.desktop_pet.get_chat(...)`

**接口**：`GET /v1/desktop-pet/projects/{project_id}/chat`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `PetChatOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## chat_messages {#chat-messages}

`client.desktop_pet.chat_messages(...)`

**接口**：`GET /v1/desktop-pet/projects/{project_id}/chat/messages`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `before` | query | integer / null | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `PetChatMessagesOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_document {#get-document}

`client.desktop_pet.get_document(...)`

**接口**：`GET /v1/desktop-pet/projects/{project_id}/document`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `PetDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_project {#patch-project}

`client.desktop_pet.patch_project(...)`

**接口**：`PATCH /v1/desktop-pet/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PetPatch | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PetProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_chat {#update-chat}

`client.desktop_pet.update_chat(...)`

**接口**：`PATCH /v1/desktop-pet/projects/{project_id}/chat`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PetChatSettingsIn | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.modelId` | 请求体 | string / null | 是 |
| `body.proactiveLinesEnabled` | 请求体 | boolean | 是 |

**响应**：
- `200` · `application/json` · `PetChatOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.desktop_pet.create_project(...)`

**接口**：`POST /v1/desktop-pet/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | PetCreate | 是 |
| `body.sourceProjectId` | 请求体 | string | 是 |
| `body.sourceRevision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `PetProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_whale {#import-whale}

`client.desktop_pet.import_whale(...)`

**接口**：`POST /v1/desktop-pet/projects/import-whale`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_import_whale_v1_desktop_pet_projects_import_whale_post | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `PetProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## send_chat_message {#send-chat-message}

`client.desktop_pet.send_chat_message(...)`

**接口**：`POST /v1/desktop-pet/projects/{project_id}/chat/messages/stream`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PetChatSendIn | 是 |
| `body.content` | 请求体 | string | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.requestId` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `object`
- `200` · `text/event-stream` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## sync_source {#sync-source}

`client.desktop_pet.sync_source(...)`

**接口**：`POST /v1/desktop-pet/projects/{project_id}/sync-source`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PetSync | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.sourceRevision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `PetDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## save_document {#save-document}

`client.desktop_pet.save_document(...)`

**接口**：`PUT /v1/desktop-pet/projects/{project_id}/document`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PetSave | 是 |
| `body.config` | 请求体 | PetConfig | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `PetDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_skin_replacement {#upload-skin-replacement}

`client.desktop_pet.upload_skin_replacement(...)`

**接口**：`PUT /v1/desktop-pet/projects/{project_id}/skins/{skin_id}/replacements/{source_asset_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `skin_id` | path | string | 是 |
| `source_asset_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_skin_replacement_v1_desktop_pet_projects__project_id__skins__skin_id__replacements__source_asset_id__put | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `PetDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
