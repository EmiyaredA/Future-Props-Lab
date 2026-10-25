<!-- docs: {"group": "api-modules", "category": "api", "order": 22, "title": "演示工坊方法参考", "lead": "client.presentation 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 演示工坊方法参考

通过 `client.presentation` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_example](#delete-example) | `DELETE /v1/presentation-workshop/examples/{example_id}` |
| [delete_project](#delete-project) | `DELETE /v1/presentation-workshop/projects/{project_id}` |
| [delete_template](#delete-template) | `DELETE /v1/presentation-workshop/templates/{template_id}` |
| [list_examples](#list-examples) | `GET /v1/presentation-workshop/examples` |
| [get_example](#get-example) | `GET /v1/presentation-workshop/examples/{example_id}` |
| [list_projects](#list-projects) | `GET /v1/presentation-workshop/projects` |
| [get_project](#get-project) | `GET /v1/presentation-workshop/projects/{project_id}` |
| [list_templates](#list-templates) | `GET /v1/presentation-workshop/templates` |
| [get_template](#get-template) | `GET /v1/presentation-workshop/templates/{template_id}` |
| [create_example](#create-example) | `POST /v1/presentation-workshop/examples` |
| [create_from_example](#create-from-example) | `POST /v1/presentation-workshop/examples/{example_id}/documents` |
| [import_project](#import-project) | `POST /v1/presentation-workshop/imports` |
| [preview_import](#preview-import) | `POST /v1/presentation-workshop/imports/preview` |
| [import_template_bundle](#import-template-bundle) | `POST /v1/presentation-workshop/library/import` |
| [create_project](#create-project) | `POST /v1/presentation-workshop/projects` |
| [export_pptx](#export-pptx) | `POST /v1/presentation-workshop/projects/{project_id}/export` |
| [preview_export](#preview-export) | `POST /v1/presentation-workshop/projects/{project_id}/export/preview` |
| [export_file](#export-file) | `POST /v1/presentation-workshop/projects/{project_id}/export/{format}` |
| [apply_presentation_operations](#apply-presentation-operations) | `POST /v1/presentation-workshop/projects/{project_id}/operations` |
| [apply_template_change](#apply-template-change) | `POST /v1/presentation-workshop/projects/{project_id}/template/apply` |
| [preview_template_change](#preview-template-change) | `POST /v1/presentation-workshop/projects/{project_id}/template/preview` |
| [create_template](#create-template) | `POST /v1/presentation-workshop/templates` |
| [create_from_template](#create-from-template) | `POST /v1/presentation-workshop/templates/{template_id}/documents` |
| [put_example](#put-example) | `PUT /v1/presentation-workshop/examples/{example_id}` |
| [put_project](#put-project) | `PUT /v1/presentation-workshop/projects/{project_id}` |
| [put_template](#put-template) | `PUT /v1/presentation-workshop/templates/{template_id}` |

## delete_example {#delete-example}

`client.presentation.delete_example(...)`

**接口**：`DELETE /v1/presentation-workshop/examples/{example_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `example_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_project {#delete-project}

`client.presentation.delete_project(...)`

**接口**：`DELETE /v1/presentation-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
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

## delete_template {#delete-template}

`client.presentation.delete_template(...)`

**接口**：`DELETE /v1/presentation-workshop/templates/{template_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `template_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_examples {#list-examples}

`client.presentation.list_examples(...)`

**接口**：`GET /v1/presentation-workshop/examples`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `query` | query | string | 否 |
| `offset` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `PresentationExampleList`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_example {#get-example}

`client.presentation.get_example(...)`

**接口**：`GET /v1/presentation-workshop/examples/{example_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `example_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationExampleOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_projects {#list-projects}

`client.presentation.list_projects(...)`

**接口**：`GET /v1/presentation-workshop/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `query` | query | string | 否 |
| `offset` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `PresentationProjectList`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.presentation.get_project(...)`

**接口**：`GET /v1/presentation-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_templates {#list-templates}

`client.presentation.list_templates(...)`

**接口**：`GET /v1/presentation-workshop/templates`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `query` | query | string | 否 |
| `offset` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `PresentationTemplateList`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_template {#get-template}

`client.presentation.get_template(...)`

**接口**：`GET /v1/presentation-workshop/templates/{template_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `template_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationTemplateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_example {#create-example}

`client.presentation.create_example(...)`

**接口**：`POST /v1/presentation-workshop/examples`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | PresentationExampleIn | 是 |
| `body.description` | 请求体 | string | 否 |
| `body.document` | 请求体 | PresentationDocument | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationExampleOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_from_example {#create-from-example}

`client.presentation.create_from_example(...)`

**接口**：`POST /v1/presentation-workshop/examples/{example_id}/documents`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `example_id` | path | string | 是 |
| `body` | application/json | TemplateCreateDocument | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_project {#import-project}

`client.presentation.import_project(...)`

**接口**：`POST /v1/presentation-workshop/imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_create_import_v1_presentation_workshop_imports_post | 是 |
| `body.allow_lossy` | 请求体 | boolean | 否 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_import {#preview-import}

`client.presentation.preview_import(...)`

**接口**：`POST /v1/presentation-workshop/imports/preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_preview_import_v1_presentation_workshop_imports_preview_post | 是 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `ImportPreview`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_template_bundle {#import-template-bundle}

`client.presentation.import_template_bundle(...)`

**接口**：`POST /v1/presentation-workshop/library/import`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | TemplateBundleIn | 是 |
| `body.example` | 请求体 | PresentationExampleIn | 是 |
| `body.template` | 请求体 | PresentationTemplateIn | 是 |

**响应**：
- `200` · `application/json` · `TemplateBundleOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.presentation.create_project(...)`

**接口**：`POST /v1/presentation-workshop/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | PresentationProjectIn | 是 |
| `body.document` | 请求体 | PresentationDocument | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_pptx {#export-pptx}

`client.presentation.export_pptx(...)`

**接口**：`POST /v1/presentation-workshop/projects/{project_id}/export`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PresentationExportIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/vnd.openxmlformats-officedocument.presentationml.presentation` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_export {#preview-export}

`client.presentation.preview_export(...)`

**接口**：`POST /v1/presentation-workshop/projects/{project_id}/export/preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PresentationExportIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `ExportPreview`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_file {#export-file}

`client.presentation.export_file(...)`

**接口**：`POST /v1/presentation-workshop/projects/{project_id}/export/{format}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `format` | path | json / fplppt | 是 |
| `body` | application/json | PresentationExportIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `string`
- `200` · `application/zip` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_presentation_operations {#apply-presentation-operations}

`client.presentation.apply_presentation_operations(...)`

**接口**：`POST /v1/presentation-workshop/projects/{project_id}/operations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PresentationOperationsIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.operations` | 请求体 | array | 是 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_template_change {#apply-template-change}

`client.presentation.apply_template_change(...)`

**接口**：`POST /v1/presentation-workshop/projects/{project_id}/template/apply`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | TemplateChangeApply | 是 |
| `body.action` | 请求体 | bind / update / unbind | 否 |
| `body.chapters` | 请求体 | array / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.mappings` | 请求体 | array | 否 |
| `body.preview_token` | 请求体 | string | 是 |
| `body.template_id` | 请求体 | string / null | 否 |
| `body.template_revision` | 请求体 | integer / null | 否 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_template_change {#preview-template-change}

`client.presentation.preview_template_change(...)`

**接口**：`POST /v1/presentation-workshop/projects/{project_id}/template/preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | TemplateChangeIn | 是 |
| `body.action` | 请求体 | bind / update / unbind | 否 |
| `body.chapters` | 请求体 | array / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.mappings` | 请求体 | array | 否 |
| `body.template_id` | 请求体 | string / null | 否 |
| `body.template_revision` | 请求体 | integer / null | 否 |

**响应**：
- `200` · `application/json` · `TemplateChangePreview`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_template {#create-template}

`client.presentation.create_template(...)`

**接口**：`POST /v1/presentation-workshop/templates`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | PresentationTemplateIn | 是 |
| `body.definition` | 请求体 | TemplateDefinition | 是 |
| `body.description` | 请求体 | string | 否 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationTemplateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_from_template {#create-from-template}

`client.presentation.create_from_template(...)`

**接口**：`POST /v1/presentation-workshop/templates/{template_id}/documents`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `template_id` | path | string | 是 |
| `body` | application/json | TemplateCreateDocument | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_example {#put-example}

`client.presentation.put_example(...)`

**接口**：`PUT /v1/presentation-workshop/examples/{example_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `example_id` | path | string | 是 |
| `body` | application/json | PresentationExamplePut | 是 |
| `body.description` | 请求体 | string | 否 |
| `body.document` | 请求体 | PresentationDocument | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationExampleOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_project {#put-project}

`client.presentation.put_project(...)`

**接口**：`PUT /v1/presentation-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | PresentationProjectPut | 是 |
| `body.document` | 请求体 | PresentationDocument | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_template {#put-template}

`client.presentation.put_template(...)`

**接口**：`PUT /v1/presentation-workshop/templates/{template_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `template_id` | path | string | 是 |
| `body` | application/json | PresentationTemplatePut | 是 |
| `body.definition` | 请求体 | TemplateDefinition | 是 |
| `body.description` | 请求体 | string | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `PresentationTemplateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
