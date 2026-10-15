<!-- docs: {"group": "api-modules", "category": "api", "order": 29, "title": "视觉工坊方法参考", "lead": "client.visual 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 视觉工坊方法参考

通过 `client.visual` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_project](#delete-project) | `DELETE /v1/visual-workshop/projects/{project_id}` |
| [delete_asset_reference](#delete-asset-reference) | `DELETE /v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}` |
| [delete_node_output](#delete-node-output) | `DELETE /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs/{output_id}` |
| [list_projects](#list-projects) | `GET /v1/visual-workshop/projects` |
| [get_project](#get-project) | `GET /v1/visual-workshop/projects/{project_id}` |
| [get_canvas](#get-canvas) | `GET /v1/visual-workshop/projects/{project_id}/canvas` |
| [list_node_outputs](#list-node-outputs) | `GET /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs` |
| [get_node_output](#get-node-output) | `GET /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs/{output_id}` |
| [export_project_snapshot](#export-project-snapshot) | `GET /v1/visual-workshop/projects/{project_id}/snapshot` |
| [patch_project](#patch-project) | `PATCH /v1/visual-workshop/projects/{project_id}` |
| [patch_asset_reference](#patch-asset-reference) | `PATCH /v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}` |
| [create_project](#create-project) | `POST /v1/visual-workshop/projects` |
| [import_project_snapshot](#import-project-snapshot) | `POST /v1/visual-workshop/projects/snapshot-imports` |
| [import_assets](#import-assets) | `POST /v1/visual-workshop/projects/{project_id}/asset-imports` |
| [create_asset_reference](#create-asset-reference) | `POST /v1/visual-workshop/projects/{project_id}/asset-references` |
| [apply_canvas_operations](#apply-canvas-operations) | `POST /v1/visual-workshop/projects/{project_id}/canvas/operations` |
| [upload_material_node](#upload-material-node) | `POST /v1/visual-workshop/projects/{project_id}/node-uploads` |
| [upload_node_output](#upload-node-output) | `POST /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/output-uploads` |
| [add_node_output](#add-node-output) | `POST /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs` |
| [reveal_project_folder](#reveal-project-folder) | `POST /v1/visual-workshop/projects/{project_id}/open-folder` |
| [put_canvas](#put-canvas) | `PUT /v1/visual-workshop/projects/{project_id}/canvas` |
| [set_node_final_output](#set-node-final-output) | `PUT /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/final-output` |

## delete_project {#delete-project}

`client.visual.delete_project(...)`

**接口**：`DELETE /v1/visual-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
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

## delete_asset_reference {#delete-asset-reference}

`client.visual.delete_asset_reference(...)`

**接口**：`DELETE /v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `reference_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_node_output {#delete-node-output}

`client.visual.delete_node_output(...)`

**接口**：`DELETE /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs/{output_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `node_id` | path | string | 是 |
| `output_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `VisualCanvasDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_projects {#list-projects}

`client.visual.list_projects(...)`

**接口**：`GET /v1/visual-workshop/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `VisualWorkshopProjectListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.visual.get_project(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VisualWorkshopProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_canvas {#get-canvas}

`client.visual.get_canvas(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/canvas`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VisualCanvasDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_node_outputs {#list-node-outputs}

`client.visual.list_node_outputs(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `node_id` | path | string | 是 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `VisualNodeOutputListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_node_output {#get-node-output}

`client.visual.get_node_output(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs/{output_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `node_id` | path | string | 是 |
| `output_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VisualNodeOutputOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_project_snapshot {#export-project-snapshot}

`client.visual.export_project_snapshot(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/snapshot`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/zip` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_project {#patch-project}

`client.visual.patch_project(...)`

**接口**：`PATCH /v1/visual-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VisualWorkshopProjectPatchIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.kind` | 请求体 | image / video / canvas / null | 否 |
| `body.status` | 请求体 | draft / completed / null | 否 |
| `body.title` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `VisualWorkshopProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_asset_reference {#patch-asset-reference}

`client.visual.patch_asset_reference(...)`

**接口**：`PATCH /v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `reference_id` | path | string | 是 |
| `body` | application/json | VisualAssetReferencePatchIn | 是 |
| `body.display_name` | 请求体 | string / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.folder_id` | 请求体 | string / null | 否 |
| `body.move_to_root` | 请求体 | boolean | 否 |

**响应**：
- `200` · `application/json` · `VisualAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.visual.create_project(...)`

**接口**：`POST /v1/visual-workshop/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | VisualWorkshopProjectCreateIn | 是 |
| `body.kind` | 请求体 | image / video / canvas | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `VisualWorkshopProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_project_snapshot {#import-project-snapshot}

`client.visual.import_project_snapshot(...)`

**接口**：`POST /v1/visual-workshop/projects/snapshot-imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_import_project_snapshot_v1_visual_workshop_projects_snapshot_imports_post | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `VisualProjectSnapshotImportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_assets {#import-assets}

`client.visual.import_assets(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/asset-imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VisualAssetImportIn | 是 |
| `body.asset_ids` | 请求体 | array | 是 |
| `body.source_project_id` | 请求体 | string / null | 否 |
| `body.source_scope` | 请求体 | library / project | 是 |

**响应**：
- `200` · `application/json` · `VisualAssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_asset_reference {#create-asset-reference}

`client.visual.create_asset_reference(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/asset-references`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VisualAssetReferenceCreateIn | 是 |
| `body.asset_id` | 请求体 | string | 是 |
| `body.folder_id` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `VisualAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_canvas_operations {#apply-canvas-operations}

`client.visual.apply_canvas_operations(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/canvas/operations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VisualOperationsIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.operations` | 请求体 | array | 是 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `VisualCanvasDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_material_node {#upload-material-node}

`client.visual.upload_material_node(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/node-uploads`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_material_node_v1_visual_workshop_projects__project_id__node_uploads_post | 是 |
| `body.category_id` | 请求体 | string / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.file` | 请求体 | string | 是 |
| `body.group` | 请求体 | string / null | 否 |
| `body.x` | 请求体 | number | 否 |
| `body.y` | 请求体 | number | 否 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `VisualCanvasDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_node_output {#upload-node-output}

`client.visual.upload_node_output(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/output-uploads`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `node_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_node_output_v1_visual_workshop_projects__project_id__nodes__node_id__output_uploads_post | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `VisualCanvasDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## add_node_output {#add-node-output}

`client.visual.add_node_output(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `node_id` | path | string | 是 |
| `body` | application/json | VisualNodeOutputCreateIn | 是 |
| `body.asset_id` | 请求体 | string / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.text` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `VisualCanvasDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## reveal_project_folder {#reveal-project-folder}

`client.visual.reveal_project_folder(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/open-folder`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ProjectFolderOpenOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_canvas {#put-canvas}

`client.visual.put_canvas(...)`

**接口**：`PUT /v1/visual-workshop/projects/{project_id}/canvas`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | VisualCanvasDocumentPutIn | 是 |
| `body.categories` | 请求体 | array / null | 否 |
| `body.edges` | 请求体 | array | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.nodes` | 请求体 | array | 是 |

**响应**：
- `200` · `application/json` · `VisualCanvasDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## set_node_final_output {#set-node-final-output}

`client.visual.set_node_final_output(...)`

**接口**：`PUT /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/final-output`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `node_id` | path | string | 是 |
| `body` | application/json | VisualNodeFinalOutputIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.output_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `VisualCanvasDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
