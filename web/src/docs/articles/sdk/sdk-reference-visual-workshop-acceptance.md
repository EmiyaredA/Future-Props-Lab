<!-- docs: {"group": "api-modules", "category": "api", "order": 31, "title": "visual_workshop_acceptance方法参考", "lead": "client.visual_workshop_acceptance 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# visual_workshop_acceptance方法参考

通过 `client.visual_workshop_acceptance` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_acceptance_template](#delete-acceptance-template) | `DELETE /v1/visual-workshop/acceptance-templates/{template_id}` |
| [list_acceptance_templates](#list-acceptance-templates) | `GET /v1/visual-workshop/acceptance-templates` |
| [list_acceptance_models](#list-acceptance-models) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/models` |
| [get_acceptance_repair](#get-acceptance-repair) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/repair-drafts/{draft_id}` |
| [list_acceptance_runs](#list-acceptance-runs) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/runs` |
| [get_acceptance_run](#get-acceptance-run) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}` |
| [get_acceptance_standard](#get-acceptance-standard) | `GET /v1/visual-workshop/projects/{project_id}/acceptance/standard` |
| [create_acceptance_template](#create-acceptance-template) | `POST /v1/visual-workshop/acceptance-templates` |
| [start_acceptance_runs](#start-acceptance-runs) | `POST /v1/visual-workshop/projects/{project_id}/acceptance/runs` |
| [cancel_acceptance_run](#cancel-acceptance-run) | `POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/cancel` |
| [decide_acceptance_run](#decide-acceptance-run) | `POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/decisions` |
| [create_acceptance_repair](#create-acceptance-repair) | `POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/repair-drafts` |
| [sample_acceptance_video](#sample-acceptance-video) | `POST /v1/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/samples` |
| [update_acceptance_template](#update-acceptance-template) | `PUT /v1/visual-workshop/acceptance-templates/{template_id}` |
| [save_acceptance_repair](#save-acceptance-repair) | `PUT /v1/visual-workshop/projects/{project_id}/acceptance/repair-drafts/{draft_id}` |
| [save_acceptance_standard](#save-acceptance-standard) | `PUT /v1/visual-workshop/projects/{project_id}/acceptance/standard` |

## delete_acceptance_template {#delete-acceptance-template}

`client.visual_workshop_acceptance.delete_acceptance_template(...)`

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

## list_acceptance_templates {#list-acceptance-templates}

`client.visual_workshop_acceptance.list_acceptance_templates(...)`

**接口**：`GET /v1/visual-workshop/acceptance-templates`。**鉴权**：Workspace API Key 或 Session。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `AcceptanceTemplateListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_acceptance_models {#list-acceptance-models}

`client.visual_workshop_acceptance.list_acceptance_models(...)`

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

`client.visual_workshop_acceptance.get_acceptance_repair(...)`

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

`client.visual_workshop_acceptance.list_acceptance_runs(...)`

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

`client.visual_workshop_acceptance.get_acceptance_run(...)`

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

`client.visual_workshop_acceptance.get_acceptance_standard(...)`

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

## create_acceptance_template {#create-acceptance-template}

`client.visual_workshop_acceptance.create_acceptance_template(...)`

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

## start_acceptance_runs {#start-acceptance-runs}

`client.visual_workshop_acceptance.start_acceptance_runs(...)`

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

`client.visual_workshop_acceptance.cancel_acceptance_run(...)`

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

`client.visual_workshop_acceptance.decide_acceptance_run(...)`

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

`client.visual_workshop_acceptance.create_acceptance_repair(...)`

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

`client.visual_workshop_acceptance.sample_acceptance_video(...)`

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

## update_acceptance_template {#update-acceptance-template}

`client.visual_workshop_acceptance.update_acceptance_template(...)`

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

`client.visual_workshop_acceptance.save_acceptance_repair(...)`

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

`client.visual_workshop_acceptance.save_acceptance_standard(...)`

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
