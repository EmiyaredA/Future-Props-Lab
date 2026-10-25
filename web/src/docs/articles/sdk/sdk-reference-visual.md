<!-- docs: {"group": "api-modules", "category": "api", "order": 31, "title": "视觉工坊方法参考", "lead": "client.visual 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 视觉工坊方法参考

通过 `client.visual` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_acceptance_template](#delete-acceptance-template) | `DELETE /v1/visual-workshop/acceptance-templates/{template_id}` |
| [delete_project](#delete-project) | `DELETE /v1/visual-workshop/projects/{project_id}` |
| [delete_asset_reference](#delete-asset-reference) | `DELETE /v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}` |
| [delete_node_output](#delete-node-output) | `DELETE /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs/{output_id}` |
| [list_acceptance_templates](#list-acceptance-templates) | `GET /v1/visual-workshop/acceptance-templates` |
| [acceptance_catalog](#acceptance-catalog) | `GET /v1/visual-workshop/acceptance/catalog` |
| [list_projects](#list-projects) | `GET /v1/visual-workshop/projects` |
| [get_project](#get-project) | `GET /v1/visual-workshop/projects/{project_id}` |
| [list_acceptance_models](#list-acceptance-models) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/models` |
| [get_acceptance_repair](#get-acceptance-repair) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/repair-drafts/{draft_id}` |
| [list_acceptance_runs](#list-acceptance-runs) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/runs` |
| [get_acceptance_run](#get-acceptance-run) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}` |
| [get_acceptance_standard](#get-acceptance-standard) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/standard` |
| [acceptance_summary](#acceptance-summary) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/summary` |
| [get_canvas](#get-canvas) | `GET /v1/visual-workshop/projects/{project_id}/canvas` |
| [get_node_acceptance](#get-node-acceptance) | `GET /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance` |
| [list_node_outputs](#list-node-outputs) | `GET /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs` |
| [get_node_output](#get-node-output) | `GET /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs/{output_id}` |
| [export_project_snapshot](#export-project-snapshot) | `GET /v1/visual-workshop/projects/{project_id}/snapshot` |
| [patch_project](#patch-project) | `PATCH /v1/visual-workshop/projects/{project_id}` |
| [patch_asset_reference](#patch-asset-reference) | `PATCH /v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}` |
| [create_acceptance_template](#create-acceptance-template) | `POST /v1/visual-workshop/acceptance-templates` |
| [create_project](#create-project) | `POST /v1/visual-workshop/projects` |
| [import_project_snapshot](#import-project-snapshot) | `POST /v1/visual-workshop/projects/snapshot-imports` |
| [start_acceptance_runs](#start-acceptance-runs) | `POST /v1/visual-workshop/projects/{project_id}/acceptance/runs` |
| [cancel_acceptance_run](#cancel-acceptance-run) | `POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/cancel` |
| [decide_acceptance_run](#decide-acceptance-run) | `POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/decisions` |
| [create_acceptance_repair](#create-acceptance-repair) | `POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/repair-drafts` |
| [sample_acceptance_video](#sample-acceptance-video) | `POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/samples` |
| [import_assets](#import-assets) | `POST /v1/visual-workshop/projects/{project_id}/asset-imports` |
| [create_asset_reference](#create-asset-reference) | `POST /v1/visual-workshop/projects/{project_id}/asset-references` |
| [apply_canvas_operations](#apply-canvas-operations) | `POST /v1/visual-workshop/projects/{project_id}/canvas/operations` |
| [upload_material_node](#upload-material-node) | `POST /v1/visual-workshop/projects/{project_id}/node-uploads` |
| [start_node_acceptance](#start-node-acceptance) | `POST /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance/runs` |
| [upload_node_output](#upload-node-output) | `POST /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/output-uploads` |
| [add_node_output](#add-node-output) | `POST /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/outputs` |
| [reveal_project_folder](#reveal-project-folder) | `POST /v1/visual-workshop/projects/{project_id}/open-folder` |
| [update_acceptance_template](#update-acceptance-template) | `PUT /v1/visual-workshop/acceptance-templates/{template_id}` |
| [save_acceptance_repair](#save-acceptance-repair) | `PUT /v1/visual-workshop/projects/{project_id}/acceptance/repair-drafts/{draft_id}` |
| [save_acceptance_standard](#save-acceptance-standard) | `PUT /v1/visual-workshop/projects/{project_id}/acceptance/standard` |
| [put_canvas](#put-canvas) | `PUT /v1/visual-workshop/projects/{project_id}/canvas` |
| [select_node_acceptance](#select-node-acceptance) | `PUT /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance` |
| [set_node_final_output](#set-node-final-output) | `PUT /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/final-output` |

## delete_acceptance_template {#delete-acceptance-template}

`client.visual.delete_acceptance_template(...)`

**接口**：`DELETE /v1/visual-workshop/acceptance-templates/{template_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `template_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

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

## list_acceptance_templates {#list-acceptance-templates}

`client.visual.list_acceptance_templates(...)`

**接口**：`GET /v1/visual-workshop/acceptance-templates`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `AcceptanceTemplateListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## acceptance_catalog {#acceptance-catalog}

`client.visual.acceptance_catalog(...)`

**接口**：`GET /v1/visual-workshop/acceptance/catalog`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `NodeAcceptanceCatalogOut`

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

## list_acceptance_models {#list-acceptance-models}

`client.visual.list_acceptance_models(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/acceptance/models`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceModelListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_acceptance_repair {#get-acceptance-repair}

`client.visual.get_acceptance_repair(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/acceptance/repair-drafts/{draft_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `draft_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceRepairOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_acceptance_runs {#list-acceptance-runs}

`client.visual.list_acceptance_runs(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/acceptance/runs`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `node_id` | query | string / null | 否 |
| `page` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `AcceptanceRunListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_acceptance_run {#get-acceptance-run}

`client.visual.get_acceptance_run(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `run_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceRunOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_acceptance_standard {#get-acceptance-standard}

`client.visual.get_acceptance_standard(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/acceptance/standard`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceStandardOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## acceptance_summary {#acceptance-summary}

`client.visual.acceptance_summary(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/acceptance/summary`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceSummaryOut`

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

## get_node_acceptance {#get-node-acceptance}

`client.visual.get_node_acceptance(...)`

**接口**：`GET /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `node_id` | path | string | 是 |
| `output_id` | query | string / null | 否 |

**响应**：
- `200` · `application/json` · `NodeAcceptanceOut`

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

## create_acceptance_template {#create-acceptance-template}

`client.visual.create_acceptance_template(...)`

**接口**：`POST /v1/visual-workshop/acceptance-templates`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | AcceptanceTemplateWriteIn | 是 |
| `body.document` | 请求体 | AcceptanceDocument | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceTemplateOut`

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

## start_acceptance_runs {#start-acceptance-runs}

`client.visual.start_acceptance_runs(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/acceptance/runs`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | AcceptanceRunCreateIn | 是 |
| `body.expected_standard_version` | 请求体 | integer | 是 |
| `body.model_id` | 请求体 | string / null | 否 |
| `body.output_ids` | 请求体 | array | 是 |
| `body.previous_run_id` | 请求体 | string / null | 否 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceRunListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cancel_acceptance_run {#cancel-acceptance-run}

`client.visual.cancel_acceptance_run(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/cancel`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `run_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceRunOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## decide_acceptance_run {#decide-acceptance-run}

`client.visual.decide_acceptance_run(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/decisions`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `run_id` | path | string | 是 |
| `body` | application/json | AcceptanceDecisionIn | 是 |
| `body.criterion_id` | 请求体 | string / null | 否 |
| `body.end_ms` | 请求体 | integer / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.finalize` | 请求体 | boolean | 否 |
| `body.reason` | 请求体 | string | 否 |
| `body.region` | 请求体 | array / null | 否 |
| `body.start_ms` | 请求体 | integer / null | 否 |
| `body.verdict` | 请求体 | passed / failed / pending / not_applicable | 否 |

**响应**：
- `200` · `application/json` · `AcceptanceRunOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_acceptance_repair {#create-acceptance-repair}

`client.visual.create_acceptance_repair(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/repair-drafts`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `run_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceRepairOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## sample_acceptance_video {#sample-acceptance-video}

`client.visual.sample_acceptance_video(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/samples`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `run_id` | path | string | 是 |
| `body` | application/json | AcceptanceSampleIn | 是 |
| `body.end_ms` | 请求体 | integer | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.start_ms` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceRunOut`

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

## start_node_acceptance {#start-node-acceptance}

`client.visual.start_node_acceptance(...)`

**接口**：`POST /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance/runs`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `node_id` | path | string | 是 |
| `body` | application/json | NodeAcceptanceStartIn | 是 |
| `body.context_fingerprint` | 请求体 | string | 是 |
| `body.expected_canvas_revision` | 请求体 | integer | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.output_id` | 请求体 | string | 是 |
| `body.previous_run_id` | 请求体 | string / null | 否 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceRunOut`

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

## update_acceptance_template {#update-acceptance-template}

`client.visual.update_acceptance_template(...)`

**接口**：`PUT /v1/visual-workshop/acceptance-templates/{template_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `template_id` | path | string | 是 |
| `body` | application/json | AcceptanceTemplateWriteIn | 是 |
| `body.document` | 请求体 | AcceptanceDocument | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceTemplateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## save_acceptance_repair {#save-acceptance-repair}

`client.visual.save_acceptance_repair(...)`

**接口**：`PUT /v1/visual-workshop/projects/{project_id}/acceptance/repair-drafts/{draft_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `draft_id` | path | string | 是 |
| `body` | application/json | AcceptanceRepairWriteIn | 是 |
| `body.apply` | 请求体 | boolean | 否 |
| `body.expected_canvas_revision` | 请求体 | integer / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.text` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `AcceptanceRepairOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## save_acceptance_standard {#save-acceptance-standard}

`client.visual.save_acceptance_standard(...)`

**接口**：`PUT /v1/visual-workshop/projects/{project_id}/acceptance/standard`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | AcceptanceStandardWriteIn | 是 |
| `body.document` | 请求体 | AcceptanceDocument | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.publish` | 请求体 | boolean | 否 |
| `body.required` | 请求体 | boolean | 否 |

**响应**：
- `200` · `application/json` · `AcceptanceStandardOut`

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

## select_node_acceptance {#select-node-acceptance}

`client.visual.select_node_acceptance(...)`

**接口**：`PUT /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `node_id` | path | string | 是 |
| `body` | application/json | NodeAcceptanceSelectIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.scheme_id` | 请求体 | motion-transfer:api / motion-transfer:codex / motion-transfer:claude-code / null | 是 |

**响应**：
- `200` · `application/json` · `NodeAcceptanceOut`

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
