<!-- docs: {"group": "api-modules", "category": "api", "order": 16, "title": "Live2D 工坊方法参考", "lead": "client.live2d_workshop 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# Live2D 工坊方法参考

通过 `client.live2d_workshop` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_project](#delete-project) | `DELETE /v1/live2d-workshop/projects/{project_id}` |
| [retire_asset](#retire-asset) | `DELETE /v1/live2d-workshop/projects/{project_id}/assets/{asset_id}` |
| [remove_cubism](#remove-cubism) | `DELETE /v1/live2d-workshop/projects/{project_id}/cubism` |
| [list_projects](#list-projects) | `GET /v1/live2d-workshop/projects` |
| [get_project](#get-project) | `GET /v1/live2d-workshop/projects/{project_id}` |
| [list_assets](#list-assets) | `GET /v1/live2d-workshop/projects/{project_id}/assets` |
| [asset_file](#asset-file) | `GET /v1/live2d-workshop/projects/{project_id}/assets/{asset_id}/file` |
| [get_cubism](#get-cubism) | `GET /v1/live2d-workshop/projects/{project_id}/cubism` |
| [download_cubism](#download-cubism) | `GET /v1/live2d-workshop/projects/{project_id}/cubism/package` |
| [get_document](#get-document) | `GET /v1/live2d-workshop/projects/{project_id}/document` |
| [list_exports](#list-exports) | `GET /v1/live2d-workshop/projects/{project_id}/exports` |
| [get_export](#get-export) | `GET /v1/live2d-workshop/projects/{project_id}/exports/{task_id}` |
| [download_export](#download-export) | `GET /v1/live2d-workshop/projects/{project_id}/exports/{task_id}/download` |
| [export_package](#export-package) | `GET /v1/live2d-workshop/projects/{project_id}/package` |
| [preview](#preview) | `GET /v1/live2d-workshop/projects/{project_id}/preview` |
| [thumbnail](#thumbnail) | `GET /v1/live2d-workshop/projects/{project_id}/thumbnail` |
| [patch_project](#patch-project) | `PATCH /v1/live2d-workshop/projects/{project_id}` |
| [create_project](#create-project) | `POST /v1/live2d-workshop/projects` |
| [import_project](#import-project) | `POST /v1/live2d-workshop/projects/import` |
| [upload_asset](#upload-asset) | `POST /v1/live2d-workshop/projects/{project_id}/assets` |
| [convert_cubism](#convert-cubism) | `POST /v1/live2d-workshop/projects/{project_id}/cubism/convert` |
| [preflight_cubism](#preflight-cubism) | `POST /v1/live2d-workshop/projects/{project_id}/cubism/preflight` |
| [create_export](#create-export) | `POST /v1/live2d-workshop/projects/{project_id}/exports` |
| [preflight](#preflight) | `POST /v1/live2d-workshop/projects/{project_id}/exports/preflight` |
| [cancel_export](#cancel-export) | `POST /v1/live2d-workshop/projects/{project_id}/exports/{task_id}/cancel` |
| [attach_cubism](#attach-cubism) | `PUT /v1/live2d-workshop/projects/{project_id}/cubism` |
| [save_cubism_bindings](#save-cubism-bindings) | `PUT /v1/live2d-workshop/projects/{project_id}/cubism/bindings` |
| [save_document](#save-document) | `PUT /v1/live2d-workshop/projects/{project_id}/document` |

## delete_project {#delete-project}

`client.live2d_workshop.delete_project(...)`

**接口**：`DELETE /v1/live2d-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
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

## retire_asset {#retire-asset}

`client.live2d_workshop.retire_asset(...)`

**接口**：`DELETE /v1/live2d-workshop/projects/{project_id}/assets/{asset_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `asset_id` | path | string | 是 |
| `expectedRevision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `Live2DProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## remove_cubism {#remove-cubism}

`client.live2d_workshop.remove_cubism(...)`

**接口**：`DELETE /v1/live2d-workshop/projects/{project_id}/cubism`。**鉴权**：Workspace API Key 或 Session。
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

## list_projects {#list-projects}

`client.live2d_workshop.list_projects(...)`

**接口**：`GET /v1/live2d-workshop/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `Live2DProjects`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.live2d_workshop.get_project(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `Live2DProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_assets {#list-assets}

`client.live2d_workshop.list_assets(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/assets`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `Live2DAssets`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## asset_file {#asset-file}

`client.live2d_workshop.asset_file(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/assets/{asset_id}/file`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `asset_id` | path | string | 是 |

**响应**：
- `200` · `image/png` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_cubism {#get-cubism}

`client.live2d_workshop.get_cubism(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/cubism`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `Live2DCubismOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_cubism {#download-cubism}

`client.live2d_workshop.download_cubism(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/cubism/package`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/zip` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_document {#get-document}

`client.live2d_workshop.get_document(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/document`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `Live2DDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_exports {#list-exports}

`client.live2d_workshop.list_exports(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/exports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `Live2DExports`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_export {#get-export}

`client.live2d_workshop.get_export(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/exports/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `Live2DExportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_export {#download-export}

`client.live2d_workshop.download_export(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/exports/{task_id}/download`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/zip` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_package {#export-package}

`client.live2d_workshop.export_package(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/package`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/zip` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview {#preview}

`client.live2d_workshop.preview(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `frame` | query | number | 否 |
| `motionId` | query | string / null | 否 |
| `expressionId` | query | string / null | 否 |
| `expectedRevision` | query | integer / null | 否 |
| `width` | query | integer | 否 |
| `height` | query | integer / null | 否 |
| `cropX` | query | number / null | 否 |
| `cropY` | query | number / null | 否 |
| `cropWidth` | query | number / null | 否 |
| `cropHeight` | query | number / null | 否 |

**响应**：
- `200` · `image/png` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## thumbnail {#thumbnail}

`client.live2d_workshop.thumbnail(...)`

**接口**：`GET /v1/live2d-workshop/projects/{project_id}/thumbnail`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `image/png` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_project {#patch-project}

`client.live2d_workshop.patch_project(...)`

**接口**：`PATCH /v1/live2d-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | Live2DPatch | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `Live2DProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.live2d_workshop.create_project(...)`

**接口**：`POST /v1/live2d-workshop/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | Live2DCreate | 是 |
| `body.height` | 请求体 | integer | 否 |
| `body.title` | 请求体 | string | 否 |
| `body.width` | 请求体 | integer | 否 |

**响应**：
- `200` · `application/json` · `Live2DProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_project {#import-project}

`client.live2d_workshop.import_project(...)`

**接口**：`POST /v1/live2d-workshop/projects/import`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_import_project_v1_live2d_workshop_projects_import_post | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `Live2DProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_asset {#upload-asset}

`client.live2d_workshop.upload_asset(...)`

**接口**：`POST /v1/live2d-workshop/projects/{project_id}/assets`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_asset_v1_live2d_workshop_projects__project_id__assets_post | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `Live2DAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## convert_cubism {#convert-cubism}

`client.live2d_workshop.convert_cubism(...)`

**接口**：`POST /v1/live2d-workshop/projects/{project_id}/cubism/convert`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_convert_cubism_v1_live2d_workshop_projects__project_id__cubism_convert_post | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.file` | 请求体 | string | 是 |
| `body.source` | 请求体 | string | 是 |
| `body.stateBindings` | 请求体 | string | 否 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `Live2DProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preflight_cubism {#preflight-cubism}

`client.live2d_workshop.preflight_cubism(...)`

**接口**：`POST /v1/live2d-workshop/projects/{project_id}/cubism/preflight`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_preflight_cubism_v1_live2d_workshop_projects__project_id__cubism_preflight_post | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_export {#create-export}

`client.live2d_workshop.create_export(...)`

**接口**：`POST /v1/live2d-workshop/projects/{project_id}/exports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | Live2DExportIn | 是 |
| `body.combinations` | 请求体 | array | 是 |
| `body.crop` | 请求体 | Live2DCrop / null | 否 |
| `body.endFrame` | 请求体 | integer | 否 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.fps` | 请求体 | integer | 否 |
| `body.height` | 请求体 | integer | 否 |
| `body.requestId` | 请求体 | string | 是 |
| `body.startFrame` | 请求体 | integer | 否 |
| `body.width` | 请求体 | integer | 否 |

**响应**：
- `200` · `application/json` · `Live2DExportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preflight {#preflight}

`client.live2d_workshop.preflight(...)`

**接口**：`POST /v1/live2d-workshop/projects/{project_id}/exports/preflight`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | Live2DExportIn | 是 |
| `body.combinations` | 请求体 | array | 是 |
| `body.crop` | 请求体 | Live2DCrop / null | 否 |
| `body.endFrame` | 请求体 | integer | 否 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.fps` | 请求体 | integer | 否 |
| `body.height` | 请求体 | integer | 否 |
| `body.requestId` | 请求体 | string | 是 |
| `body.startFrame` | 请求体 | integer | 否 |
| `body.width` | 请求体 | integer | 否 |

**响应**：
- `200` · `application/json` · `Live2DPreflight`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cancel_export {#cancel-export}

`client.live2d_workshop.cancel_export(...)`

**接口**：`POST /v1/live2d-workshop/projects/{project_id}/exports/{task_id}/cancel`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `Live2DExportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## attach_cubism {#attach-cubism}

`client.live2d_workshop.attach_cubism(...)`

**接口**：`PUT /v1/live2d-workshop/projects/{project_id}/cubism`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_attach_cubism_v1_live2d_workshop_projects__project_id__cubism_put | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `Live2DCubismOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## save_cubism_bindings {#save-cubism-bindings}

`client.live2d_workshop.save_cubism_bindings(...)`

**接口**：`PUT /v1/live2d-workshop/projects/{project_id}/cubism/bindings`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | Live2DCubismBindings | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.stateBindings` | 请求体 | object | 是 |

**响应**：
- `200` · `application/json` · `Live2DCubismOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## save_document {#save-document}

`client.live2d_workshop.save_document(...)`

**接口**：`PUT /v1/live2d-workshop/projects/{project_id}/document`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | Live2DSave | 是 |
| `body.document` | 请求体 | CharacterDocument | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `Live2DDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
