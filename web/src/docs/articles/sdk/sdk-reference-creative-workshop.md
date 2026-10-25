<!-- docs: {"group": "api-modules", "category": "api", "order": 5, "title": "创意工坊方法参考", "lead": "client.creative_workshop 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 创意工坊方法参考

通过 `client.creative_workshop` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [list_items](#list-items) | `GET /v1/creative-workshop/items` |
| [get_item](#get-item) | `GET /v1/creative-workshop/items/{item_id}` |
| [item_cover](#item-cover) | `GET /v1/creative-workshop/items/{item_id}/cover` |
| [get_release](#get-release) | `GET /v1/creative-workshop/releases/{release_id}` |
| [release_cover](#release-cover) | `GET /v1/creative-workshop/releases/{release_id}/cover` |
| [update_item](#update-item) | `PATCH /v1/creative-workshop/items/{item_id}` |
| [install](#install) | `POST /v1/creative-workshop/installations` |
| [preview_install](#preview-install) | `POST /v1/creative-workshop/installations/preview` |
| [configure_stdio](#configure-stdio) | `POST /v1/creative-workshop/installations/{installation_id}/stdio` |
| [create_item](#create-item) | `POST /v1/creative-workshop/items` |
| [import_item](#import-item) | `POST /v1/creative-workshop/items/from-integration` |
| [upload_cover](#upload-cover) | `POST /v1/creative-workshop/items/{item_id}/cover` |
| [publish_item](#publish-item) | `POST /v1/creative-workshop/items/{item_id}/publish` |
| [upload_skill](#upload-skill) | `POST /v1/creative-workshop/items/{item_id}/skill-archive` |
| [withdraw_item](#withdraw-item) | `POST /v1/creative-workshop/items/{item_id}/withdraw` |

## list_items {#list-items}

`client.creative_workshop.list_items(...)`

**接口**：`GET /v1/creative-workshop/items`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `kind` | query | string / null | 否 |
| `q` | query | string | 否 |
| `mine` | query | boolean | 否 |
| `cursor` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `CreativePageOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_item {#get-item}

`client.creative_workshop.get_item(...)`

**接口**：`GET /v1/creative-workshop/items/{item_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `item_id` | path | string | 是 |
| `draft` | query | boolean | 否 |

**响应**：
- `200` · `application/json` · `CreativeItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## item_cover {#item-cover}

`client.creative_workshop.item_cover(...)`

**接口**：`GET /v1/creative-workshop/items/{item_id}/cover`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `item_id` | path | string | 是 |
| `draft` | query | boolean | 否 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_release {#get-release}

`client.creative_workshop.get_release(...)`

**接口**：`GET /v1/creative-workshop/releases/{release_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `release_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `CreativeReleaseOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## release_cover {#release-cover}

`client.creative_workshop.release_cover(...)`

**接口**：`GET /v1/creative-workshop/releases/{release_id}/cover`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `release_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_item {#update-item}

`client.creative_workshop.update_item(...)`

**接口**：`PATCH /v1/creative-workshop/items/{item_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `item_id` | path | string | 是 |
| `body` | application/json | CreativeDraftUpdateIn | 是 |
| `body.components` | 请求体 | array | 否 |
| `body.cover_preset` | 请求体 | sunrise / violet / ocean / mint | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.kind` | 请求体 | tool_api / mcp / skill / bundle | 是 |
| `body.manifest` | 请求体 | object | 否 |
| `body.summary` | 请求体 | string | 否 |
| `body.tags` | 请求体 | array | 否 |
| `body.title` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `CreativeItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## install {#install}

`client.creative_workshop.install(...)`

**接口**：`POST /v1/creative-workshop/installations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | CreativeInstallPreviewIn | 是 |
| `body.names` | 请求体 | object | 否 |
| `body.release_id` | 请求体 | string | 是 |

**响应**：
- `201` · `application/json` · `CreativeInstallOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_install {#preview-install}

`client.creative_workshop.preview_install(...)`

**接口**：`POST /v1/creative-workshop/installations/preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | CreativeInstallPreviewIn | 是 |
| `body.names` | 请求体 | object | 否 |
| `body.release_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `CreativeInstallPreviewOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## configure_stdio {#configure-stdio}

`client.creative_workshop.configure_stdio(...)`

**接口**：`POST /v1/creative-workshop/installations/{installation_id}/stdio`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `installation_id` | path | string | 是 |
| `body` | application/json | CreativeStdioSetupIn | 是 |
| `body.arguments` | 请求体 | array | 否 |
| `body.command` | 请求体 | string | 是 |
| `body.environment` | 请求体 | object | 否 |
| `body.release_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `CreativeInstallOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_item {#create-item}

`client.creative_workshop.create_item(...)`

**接口**：`POST /v1/creative-workshop/items`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | CreativeDraftIn | 是 |
| `body.components` | 请求体 | array | 否 |
| `body.cover_preset` | 请求体 | sunrise / violet / ocean / mint | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.kind` | 请求体 | tool_api / mcp / skill / bundle | 是 |
| `body.manifest` | 请求体 | object | 否 |
| `body.summary` | 请求体 | string | 否 |
| `body.tags` | 请求体 | array | 否 |
| `body.title` | 请求体 | string | 否 |

**响应**：
- `201` · `application/json` · `CreativeItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_item {#import-item}

`client.creative_workshop.import_item(...)`

**接口**：`POST /v1/creative-workshop/items/from-integration`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | CreativeImportIn | 是 |
| `body.kind` | 请求体 | tool_api / mcp / skill | 是 |
| `body.source_id` | 请求体 | string | 是 |

**响应**：
- `201` · `application/json` · `CreativeItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_cover {#upload-cover}

`client.creative_workshop.upload_cover(...)`

**接口**：`POST /v1/creative-workshop/items/{item_id}/cover`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `item_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_cover_v1_creative_workshop_items__item_id__cover_post | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `CreativeItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## publish_item {#publish-item}

`client.creative_workshop.publish_item(...)`

**接口**：`POST /v1/creative-workshop/items/{item_id}/publish`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `item_id` | path | string | 是 |
| `body` | application/json | CreativeRevisionIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `CreativeItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_skill {#upload-skill}

`client.creative_workshop.upload_skill(...)`

**接口**：`POST /v1/creative-workshop/items/{item_id}/skill-archive`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `item_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_skill_v1_creative_workshop_items__item_id__skill_archive_post | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `CreativeItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## withdraw_item {#withdraw-item}

`client.creative_workshop.withdraw_item(...)`

**接口**：`POST /v1/creative-workshop/items/{item_id}/withdraw`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `item_id` | path | string | 是 |
| `body` | application/json | CreativeRevisionIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `CreativeItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
