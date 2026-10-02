<!-- docs: {"group": "api-modules", "category": "api", "order": 10, "title": "文件管理方法参考", "lead": "client.files 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 文件管理方法参考

通过 `client.files` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_file_folder](#delete-file-folder) | `DELETE /v1/file-folders/{folder_id}` |
| [delete_file](#delete-file) | `DELETE /v1/files/{asset_id}` |
| [list_file_folders](#list-file-folders) | `GET /v1/file-folders` |
| [export_library_folder_archive](#export-library-folder-archive) | `GET /v1/file-library/folder-exports` |
| [storage_layout_status](#storage-layout-status) | `GET /v1/file-storage/layout` |
| [list_files](#list-files) | `GET /v1/files` |
| [preview_file](#preview-file) | `GET /v1/files/{asset_id}/content` |
| [download_file](#download-file) | `GET /v1/files/{asset_id}/download` |
| [patch_file_folder](#patch-file-folder) | `PATCH /v1/file-folders/{folder_id}` |
| [patch_file](#patch-file) | `PATCH /v1/files/{asset_id}` |
| [create_file_folder](#create-file-folder) | `POST /v1/file-folders` |
| [import_project_assets_to_library](#import-project-assets-to-library) | `POST /v1/file-library/asset-imports` |
| [import_library_folder_archive](#import-library-folder-archive) | `POST /v1/file-library/folder-archive-imports` |
| [import_library_folder_entries](#import-library-folder-entries) | `POST /v1/file-library/folder-entry-imports` |
| [migrate_storage_layout](#migrate-storage-layout) | `POST /v1/file-storage/layout/migrate` |
| [reveal_library_folder](#reveal-library-folder) | `POST /v1/file-storage/open-folder` |
| [upload_file](#upload-file) | `POST /v1/files` |
| [preview_svg](#preview-svg) | `POST /v1/files/svg/preview` |
| [crop_file_image](#crop-file-image) | `POST /v1/files/{asset_id}/crop` |
| [extract_video_frames](#extract-video-frames) | `POST /v1/files/{asset_id}/frames` |

## delete_file_folder {#delete-file-folder}

`client.files.delete_file_folder(...)`

**接口**：`DELETE /v1/file-folders/{folder_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `folder_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_file {#delete-file}

`client.files.delete_file(...)`

**接口**：`DELETE /v1/files/{asset_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `asset_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_file_folders {#list-file-folders}

`client.files.list_file_folders(...)`

**接口**：`GET /v1/file-folders`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | query | string / null | 否 |

**响应**：
- `200` · `application/json` · `VisualAssetFolderListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_library_folder_archive {#export-library-folder-archive}

`client.files.export_library_folder_archive(...)`

**接口**：`GET /v1/file-library/folder-exports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `folder_id` | query | string / null | 否 |

**响应**：
- `200` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## storage_layout_status {#storage-layout-status}

`client.files.storage_layout_status(...)`

**接口**：`GET /v1/file-storage/layout`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `StorageLayoutStatusOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_files {#list-files}

`client.files.list_files(...)`

**接口**：`GET /v1/files`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | query | string / null | 否 |
| `folder_id` | query | string / null | 否 |
| `query` | query | string | 否 |
| `media_kind` | query | image / video / audio / font / document / null | 否 |
| `sort` | query | updated / name | 否 |
| `include_references` | query | boolean | 否 |
| `include_svg` | query | boolean | 否 |

**响应**：
- `200` · `application/json` · `VisualAssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_file {#preview-file}

`client.files.preview_file(...)`

**接口**：`GET /v1/files/{asset_id}/content`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `asset_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_file {#download-file}

`client.files.download_file(...)`

**接口**：`GET /v1/files/{asset_id}/download`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `asset_id` | path | string | 是 |
| `download_name` | query | string / null | 否 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_file_folder {#patch-file-folder}

`client.files.patch_file_folder(...)`

**接口**：`PATCH /v1/file-folders/{folder_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `folder_id` | path | string | 是 |
| `body` | application/json | VisualAssetFolderPatchIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.move_to_root` | 请求体 | boolean | 否 |
| `body.name` | 请求体 | string / null | 否 |
| `body.parent_id` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `VisualAssetFolderOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_file {#patch-file}

`client.files.patch_file(...)`

**接口**：`PATCH /v1/files/{asset_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `asset_id` | path | string | 是 |
| `body` | application/json | VisualAssetPatchIn | 是 |
| `body.display_name` | 请求体 | string / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.folder_id` | 请求体 | string / null | 否 |
| `body.move_to_root` | 请求体 | boolean | 否 |

**响应**：
- `200` · `application/json` · `VisualAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_file_folder {#create-file-folder}

`client.files.create_file_folder(...)`

**接口**：`POST /v1/file-folders`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | VisualAssetFolderCreateIn | 是 |
| `body.name` | 请求体 | string | 是 |
| `body.parent_id` | 请求体 | string / null | 否 |
| `body.project_id` | 请求体 | string / null | 否 |
| `body.scope` | 请求体 | library / project | 是 |

**响应**：
- `200` · `application/json` · `VisualAssetFolderOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_project_assets_to_library {#import-project-assets-to-library}

`client.files.import_project_assets_to_library(...)`

**接口**：`POST /v1/file-library/asset-imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | LibraryAssetImportIn | 是 |
| `body.asset_ids` | 请求体 | array | 是 |
| `body.display_names` | 请求体 | object | 否 |
| `body.folder_id` | 请求体 | string / null | 否 |
| `body.source_project_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `VisualAssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_library_folder_archive {#import-library-folder-archive}

`client.files.import_library_folder_archive(...)`

**接口**：`POST /v1/file-library/folder-archive-imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_import_library_folder_archive_v1_file_library_folder_archive_imports_post | 是 |
| `body.archive` | 请求体 | string | 是 |
| `body.parent_folder_id` | 请求体 | string / null | 否 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `LibraryFolderImportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_library_folder_entries {#import-library-folder-entries}

`client.files.import_library_folder_entries(...)`

**接口**：`POST /v1/file-library/folder-entry-imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_import_library_folder_entries_v1_file_library_folder_entry_imports_post | 是 |
| `body.files` | 请求体 | array | 是 |
| `body.parent_folder_id` | 请求体 | string / null | 否 |
| `body.relative_paths` | 请求体 | array | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `LibraryFolderImportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## migrate_storage_layout {#migrate-storage-layout}

`client.files.migrate_storage_layout(...)`

**接口**：`POST /v1/file-storage/layout/migrate`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `StorageLayoutMigrationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## reveal_library_folder {#reveal-library-folder}

`client.files.reveal_library_folder(...)`

**接口**：`POST /v1/file-storage/open-folder`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ProjectFolderOpenOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_file {#upload-file}

`client.files.upload_file(...)`

**接口**：`POST /v1/files`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_upload_file_v1_files_post | 是 |
| `body.display_name` | 请求体 | string / null | 否 |
| `body.folder_id` | 请求体 | string / null | 否 |
| `body.project_id` | 请求体 | string / null | 否 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `VisualAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_svg {#preview-svg}

`client.files.preview_svg(...)`

**接口**：`POST /v1/files/svg/preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | SvgPreviewIn | 是 |
| `body.svg` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `SvgPreviewOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## crop_file_image {#crop-file-image}

`client.files.crop_file_image(...)`

**接口**：`POST /v1/files/{asset_id}/crop`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `asset_id` | path | string | 是 |
| `body` | application/json | ImageCropIn | 是 |
| `body.height` | 请求体 | integer | 是 |
| `body.width` | 请求体 | integer | 是 |
| `body.x` | 请求体 | integer | 是 |
| `body.y` | 请求体 | integer | 是 |

**响应**：
- `200` · `image/png` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## extract_video_frames {#extract-video-frames}

`client.files.extract_video_frames(...)`

**接口**：`POST /v1/files/{asset_id}/frames`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `asset_id` | path | string | 是 |
| `body` | application/json | VideoFramesIn | 是 |
| `body.max_width` | 请求体 | integer | 否 |
| `body.output` | 请求体 | zip / grid | 否 |
| `body.positions_ms` | 请求体 | array | 是 |

**响应**：
- `200` · `application/octet-stream` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
