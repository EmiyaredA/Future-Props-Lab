<!-- docs: {"group": "api-modules", "category": "api", "order": 19, "title": "特效制作工坊方法参考", "lead": "client.motion_compositor 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 特效制作工坊方法参考

通过 `client.motion_compositor` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_project](#delete-project) | `DELETE /v1/motion-compositor/projects/{project_id}` |
| [import_sources](#import-sources) | `GET /v1/motion-compositor/import-sources` |
| [list_projects](#list-projects) | `GET /v1/motion-compositor/projects` |
| [get_project](#get-project) | `GET /v1/motion-compositor/projects/{project_id}` |
| [list_assets](#list-assets) | `GET /v1/motion-compositor/projects/{project_id}/assets` |
| [asset_file](#asset-file) | `GET /v1/motion-compositor/projects/{project_id}/assets/{asset_id}/file` |
| [get_document](#get-document) | `GET /v1/motion-compositor/projects/{project_id}/document` |
| [list_exports](#list-exports) | `GET /v1/motion-compositor/projects/{project_id}/exports` |
| [get_export](#get-export) | `GET /v1/motion-compositor/projects/{project_id}/exports/{task_id}` |
| [download_export](#download-export) | `GET /v1/motion-compositor/projects/{project_id}/exports/{task_id}/download/{format_name}` |
| [exact_frame](#exact-frame) | `GET /v1/motion-compositor/projects/{project_id}/preview/frame` |
| [export_snapshot](#export-snapshot) | `GET /v1/motion-compositor/projects/{project_id}/snapshot` |
| [patch_project](#patch-project) | `PATCH /v1/motion-compositor/projects/{project_id}` |
| [create_project](#create-project) | `POST /v1/motion-compositor/projects` |
| [import_snapshot](#import-snapshot) | `POST /v1/motion-compositor/projects/snapshot-imports` |
| [upload_asset](#upload-asset) | `POST /v1/motion-compositor/projects/{project_id}/assets` |
| [import_assets](#import-assets) | `POST /v1/motion-compositor/projects/{project_id}/assets/import` |
| [edit_document](#edit-document) | `POST /v1/motion-compositor/projects/{project_id}/document/operations` |
| [create_export](#create-export) | `POST /v1/motion-compositor/projects/{project_id}/exports` |
| [cancel_export](#cancel-export) | `POST /v1/motion-compositor/projects/{project_id}/exports/{task_id}/cancel` |
| [send_to_video_editor](#send-to-video-editor) | `POST /v1/motion-compositor/projects/{project_id}/exports/{task_id}/video-editor-handoffs` |

## delete_project {#delete-project}

`client.motion_compositor.delete_project(...)`

**接口**：`DELETE /v1/motion-compositor/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
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

## import_sources {#import-sources}

`client.motion_compositor.import_sources(...)`

**接口**：`GET /v1/motion-compositor/import-sources`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ImportSourceListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_projects {#list-projects}

`client.motion_compositor.list_projects(...)`

**接口**：`GET /v1/motion-compositor/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ProjectListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.motion_compositor.get_project(...)`

**接口**：`GET /v1/motion-compositor/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_assets {#list-assets}

`client.motion_compositor.list_assets(...)`

**接口**：`GET /v1/motion-compositor/projects/{project_id}/assets`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `AssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## asset_file {#asset-file}

`client.motion_compositor.asset_file(...)`

**接口**：`GET /v1/motion-compositor/projects/{project_id}/assets/{asset_id}/file`。**鉴权**：Workspace API Key 或 Session。
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

## get_document {#get-document}

`client.motion_compositor.get_document(...)`

**接口**：`GET /v1/motion-compositor/projects/{project_id}/document`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `DocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_exports {#list-exports}

`client.motion_compositor.list_exports(...)`

**接口**：`GET /v1/motion-compositor/projects/{project_id}/exports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ExportListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_export {#get-export}

`client.motion_compositor.get_export(...)`

**接口**：`GET /v1/motion-compositor/projects/{project_id}/exports/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ExportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_export {#download-export}

`client.motion_compositor.download_export(...)`

**接口**：`GET /v1/motion-compositor/projects/{project_id}/exports/{task_id}/download/{format_name}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |
| `format_name` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## exact_frame {#exact-frame}

`client.motion_compositor.exact_frame(...)`

**接口**：`GET /v1/motion-compositor/projects/{project_id}/preview/frame`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `frame` | query | integer | 是 |
| `revision` | query | integer / null | 否 |

**响应**：
- `200` · `application/json` · `object`
- `200` · `image/png` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_snapshot {#export-snapshot}

`client.motion_compositor.export_snapshot(...)`

**接口**：`GET /v1/motion-compositor/projects/{project_id}/snapshot`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`
- `200` · `application/zip` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_project {#patch-project}

`client.motion_compositor.patch_project(...)`

**接口**：`PATCH /v1/motion-compositor/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | ProjectPatchIn | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.motion_compositor.create_project(...)`

**接口**：`POST /v1/motion-compositor/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ProjectCreateIn | 是 |
| `body.aspect` | 请求体 | 16:9 / 9:16 / 1:1 | 否 |
| `body.fps` | 请求体 | 30 / 60 | 否 |
| `body.starter` | 请求体 | blank / comic-entry | 否 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_snapshot {#import-snapshot}

`client.motion_compositor.import_snapshot(...)`

**接口**：`POST /v1/motion-compositor/projects/snapshot-imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_import_snapshot_v1_motion_compositor_projects_snapshot_imports_post | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `ProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_asset {#upload-asset}

`client.motion_compositor.upload_asset(...)`

**接口**：`POST /v1/motion-compositor/projects/{project_id}/assets`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_asset_v1_motion_compositor_projects__project_id__assets_post | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `AssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_assets {#import-assets}

`client.motion_compositor.import_assets(...)`

**接口**：`POST /v1/motion-compositor/projects/{project_id}/assets/import`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | AssetImportIn | 是 |
| `body.assetIds` | 请求体 | array | 是 |

**响应**：
- `200` · `application/json` · `AssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## edit_document {#edit-document}

`client.motion_compositor.edit_document(...)`

**接口**：`POST /v1/motion-compositor/projects/{project_id}/document/operations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | OperationBatchIn | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.operations` | 请求体 | array | 是 |
| `body.requestId` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `DocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_export {#create-export}

`client.motion_compositor.create_export(...)`

**接口**：`POST /v1/motion-compositor/projects/{project_id}/exports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | ExportCreateIn | 是 |
| `body.endFrame` | 请求体 | integer / null | 否 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.formats` | 请求体 | array | 是 |
| `body.requestId` | 请求体 | string | 是 |
| `body.startFrame` | 请求体 | integer | 否 |

**响应**：
- `200` · `application/json` · `ExportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cancel_export {#cancel-export}

`client.motion_compositor.cancel_export(...)`

**接口**：`POST /v1/motion-compositor/projects/{project_id}/exports/{task_id}/cancel`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ExportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## send_to_video_editor {#send-to-video-editor}

`client.motion_compositor.send_to_video_editor(...)`

**接口**：`POST /v1/motion-compositor/projects/{project_id}/exports/{task_id}/video-editor-handoffs`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |
| `body` | application/json | HandoffIn | 是 |
| `body.format` | 请求体 | mp4 / mov4444 | 是 |
| `body.newProjectTitle` | 请求体 | string / null | 否 |
| `body.targetProjectId` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `HandoffOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
