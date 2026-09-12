<!-- docs: {"group": "api-modules", "category": "api", "order": 21, "title": "视频剪辑方法参考", "lead": "client.video 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 视频剪辑方法参考

通过 `client.video` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_project](#delete-project) | `DELETE /v1/video-editor/projects/{project_id}` |
| [delete_asset](#delete-asset) | `DELETE /v1/video-editor/projects/{project_id}/assets/{asset_id}` |
| [delete_render](#delete-render) | `DELETE /v1/video-editor/projects/{project_id}/renders/{task_id}` |
| [import_sources](#import-sources) | `GET /v1/video-editor/import-sources` |
| [list_projects](#list-projects) | `GET /v1/video-editor/projects` |
| [get_project](#get-project) | `GET /v1/video-editor/projects/{project_id}` |
| [list_assets](#list-assets) | `GET /v1/video-editor/projects/{project_id}/assets` |
| [asset_variant](#asset-variant) | `GET /v1/video-editor/projects/{project_id}/assets/{asset_id}/{variant}` |
| [exact_frame](#exact-frame) | `GET /v1/video-editor/projects/{project_id}/preview/frame` |
| [list_renders](#list-renders) | `GET /v1/video-editor/projects/{project_id}/renders` |
| [get_render](#get-render) | `GET /v1/video-editor/projects/{project_id}/renders/{task_id}` |
| [list_segment_exports](#list-segment-exports) | `GET /v1/video-editor/projects/{project_id}/segment-exports` |
| [get_segment_export](#get-segment-export) | `GET /v1/video-editor/projects/{project_id}/segment-exports/{task_id}` |
| [download_segment_export](#download-segment-export) | `GET /v1/video-editor/projects/{project_id}/segment-exports/{task_id}/download` |
| [export_project_snapshot](#export-project-snapshot) | `GET /v1/video-editor/projects/{project_id}/snapshot` |
| [get_timeline](#get-timeline) | `GET /v1/video-editor/projects/{project_id}/timeline` |
| [patch_project](#patch-project) | `PATCH /v1/video-editor/projects/{project_id}` |
| [create_project](#create-project) | `POST /v1/video-editor/projects` |
| [import_project_snapshot](#import-project-snapshot) | `POST /v1/video-editor/projects/snapshot-imports` |
| [upload_asset](#upload-asset) | `POST /v1/video-editor/projects/{project_id}/assets` |
| [import_assets](#import-assets) | `POST /v1/video-editor/projects/{project_id}/assets/import` |
| [retry_proxy](#retry-proxy) | `POST /v1/video-editor/projects/{project_id}/assets/{asset_id}/proxy/retry` |
| [reveal_project_folder](#reveal-project-folder) | `POST /v1/video-editor/projects/{project_id}/open-folder` |
| [create_render](#create-render) | `POST /v1/video-editor/projects/{project_id}/renders` |
| [render_preflight](#render-preflight) | `POST /v1/video-editor/projects/{project_id}/renders/preflight` |
| [cancel_render](#cancel-render) | `POST /v1/video-editor/projects/{project_id}/renders/{task_id}/cancel` |
| [create_segment_export](#create-segment-export) | `POST /v1/video-editor/projects/{project_id}/segment-exports` |
| [cancel_segment_export](#cancel-segment-export) | `POST /v1/video-editor/projects/{project_id}/segment-exports/{task_id}/cancel` |
| [apply_timeline_operations](#apply-timeline-operations) | `POST /v1/video-editor/projects/{project_id}/timeline/operations` |

## delete_project {#delete-project}

`client.video.delete_project(...)`

**接口**：`DELETE /v1/video-editor/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
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

## delete_asset {#delete-asset}

`client.video.delete_asset(...)`

**接口**：`DELETE /v1/video-editor/projects/{project_id}/assets/{asset_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `asset_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_render {#delete-render}

`client.video.delete_render(...)`

**接口**：`DELETE /v1/video-editor/projects/{project_id}/renders/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_sources {#import-sources}

`client.video.import_sources(...)`

**接口**：`GET /v1/video-editor/import-sources`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `VideoEditorAvailableAssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_projects {#list-projects}

`client.video.list_projects(...)`

**接口**：`GET /v1/video-editor/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `VideoEditorProjectListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.video.get_project(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_assets {#list-assets}

`client.video.list_assets(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}/assets`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorAssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## asset_variant {#asset-variant}

`client.video.asset_variant(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}/assets/{asset_id}/{variant}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `asset_id` | path | string | 是 |
| `variant` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## exact_frame {#exact-frame}

`client.video.exact_frame(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}/preview/frame`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `revision` | query | integer | 是 |
| `timeUs` | query | integer | 是 |
| `width` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_renders {#list-renders}

`client.video.list_renders(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}/renders`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorTaskListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_render {#get-render}

`client.video.get_render(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}/renders/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_segment_exports {#list-segment-exports}

`client.video.list_segment_exports(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}/segment-exports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorTaskListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_segment_export {#get-segment-export}

`client.video.get_segment_export(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}/segment-exports/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_segment_export {#download-segment-export}

`client.video.download_segment_export(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}/segment-exports/{task_id}/download`。**鉴权**：Workspace API Key 或 Session。
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

## export_project_snapshot {#export-project-snapshot}

`client.video.export_project_snapshot(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}/snapshot`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/zip` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_timeline {#get-timeline}

`client.video.get_timeline(...)`

**接口**：`GET /v1/video-editor/projects/{project_id}/timeline`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorTimelineOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_project {#patch-project}

`client.video.patch_project(...)`

**接口**：`PATCH /v1/video-editor/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VideoEditorProjectPatchIn | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.status` | 请求体 | draft / completed / null | 否 |
| `body.title` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `VideoEditorProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.video.create_project(...)`

**接口**：`POST /v1/video-editor/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | VideoEditorProjectCreateIn | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_project_snapshot {#import-project-snapshot}

`client.video.import_project_snapshot(...)`

**接口**：`POST /v1/video-editor/projects/snapshot-imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_import_project_snapshot_v1_video_editor_projects_snapshot_imports_post | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `VideoEditorProjectSnapshotImportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_asset {#upload-asset}

`client.video.upload_asset(...)`

**接口**：`POST /v1/video-editor/projects/{project_id}/assets`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_asset_v1_video_editor_projects__project_id__assets_post | 是 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `VideoEditorAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_assets {#import-assets}

`client.video.import_assets(...)`

**接口**：`POST /v1/video-editor/projects/{project_id}/assets/import`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VideoEditorAssetImportIn | 是 |
| `body.assetIds` | 请求体 | array | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorAssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## retry_proxy {#retry-proxy}

`client.video.retry_proxy(...)`

**接口**：`POST /v1/video-editor/projects/{project_id}/assets/{asset_id}/proxy/retry`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `asset_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## reveal_project_folder {#reveal-project-folder}

`client.video.reveal_project_folder(...)`

**接口**：`POST /v1/video-editor/projects/{project_id}/open-folder`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ProjectFolderOpenOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_render {#create-render}

`client.video.create_render(...)`

**接口**：`POST /v1/video-editor/projects/{project_id}/renders`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VideoEditorRenderCreateIn | 是 |
| `body.endUs` | 请求体 | integer / null | 否 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.preset` | 请求体 | 720p30 / 1080p30 / 720p60 / 1080p60 | 否 |
| `body.previewFingerprint` | 请求体 | string | 是 |
| `body.requestId` | 请求体 | string | 是 |
| `body.startUs` | 请求体 | integer | 否 |

**响应**：
- `200` · `application/json` · `VideoEditorTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## render_preflight {#render-preflight}

`client.video.render_preflight(...)`

**接口**：`POST /v1/video-editor/projects/{project_id}/renders/preflight`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VideoEditorRenderPreviewIn | 是 |
| `body.endUs` | 请求体 | integer / null | 否 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.preset` | 请求体 | 720p30 / 1080p30 / 720p60 / 1080p60 | 否 |
| `body.startUs` | 请求体 | integer | 否 |

**响应**：
- `200` · `application/json` · `VideoEditorRenderPreviewOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cancel_render {#cancel-render}

`client.video.cancel_render(...)`

**接口**：`POST /v1/video-editor/projects/{project_id}/renders/{task_id}/cancel`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_segment_export {#create-segment-export}

`client.video.create_segment_export(...)`

**接口**：`POST /v1/video-editor/projects/{project_id}/segment-exports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VideoEditorSegmentExportCreateIn | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.requestId` | 请求体 | string | 是 |
| `body.segments` | 请求体 | array | 是 |
| `body.target` | 请求体 | VideoEditorSegmentExportTarget / null | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cancel_segment_export {#cancel-segment-export}

`client.video.cancel_segment_export(...)`

**接口**：`POST /v1/video-editor/projects/{project_id}/segment-exports/{task_id}/cancel`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_timeline_operations {#apply-timeline-operations}

`client.video.apply_timeline_operations(...)`

**接口**：`POST /v1/video-editor/projects/{project_id}/timeline/operations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VideoEditorTimelineBatchIn | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.operations` | 请求体 | array | 是 |
| `body.requestId` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEditorTimelineOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
