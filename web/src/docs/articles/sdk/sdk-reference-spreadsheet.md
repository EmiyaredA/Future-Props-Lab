<!-- docs: {"group": "api-modules", "category": "api", "order": 21, "title": "spreadsheet方法参考", "lead": "client.spreadsheet 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# spreadsheet方法参考

通过 `client.spreadsheet` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_project](#delete-project) | `DELETE /v1/spreadsheet-workshop/projects/{project_id}` |
| [list_projects](#list-projects) | `GET /v1/spreadsheet-workshop/projects` |
| [get_project](#get-project) | `GET /v1/spreadsheet-workshop/projects/{project_id}` |
| [download_original](#download-original) | `GET /v1/spreadsheet-workshop/projects/{project_id}/original` |
| [read_range](#read-range) | `GET /v1/spreadsheet-workshop/projects/{project_id}/range` |
| [preview_import](#preview-import) | `POST /v1/spreadsheet-workshop/imports/preview` |
| [confirm_import](#confirm-import) | `POST /v1/spreadsheet-workshop/imports/{import_id}/confirm` |
| [create_project](#create-project) | `POST /v1/spreadsheet-workshop/projects` |
| [export_workbook](#export-workbook) | `POST /v1/spreadsheet-workshop/projects/{project_id}/export` |
| [apply_operations](#apply-operations) | `POST /v1/spreadsheet-workshop/projects/{project_id}/operations` |
| [update_project](#update-project) | `PUT /v1/spreadsheet-workshop/projects/{project_id}` |

## delete_project {#delete-project}

`client.spreadsheet.delete_project(...)`

**接口**：`DELETE /v1/spreadsheet-workshop/projects/{project_id}`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |
| `request_id` | query | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_projects {#list-projects}

`client.spreadsheet.list_projects(...)`

**接口**：`GET /v1/spreadsheet-workshop/projects`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `query` | query | string | 否 |
| `offset` | query | integer | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `SpreadsheetList`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.spreadsheet.get_project(...)`

**接口**：`GET /v1/spreadsheet-workshop/projects/{project_id}`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `SpreadsheetProject`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_original {#download-original}

`client.spreadsheet.download_original(...)`

**接口**：`GET /v1/spreadsheet-workshop/projects/{project_id}/original`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/octet-stream` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## read_range {#read-range}

`client.spreadsheet.read_range(...)`

**接口**：`GET /v1/spreadsheet-workshop/projects/{project_id}/range`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `sheet_id` | query | string | 是 |
| `range` | query | string | 是 |

**响应**：
- `200` · `application/json` · `SpreadsheetRange`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_import {#preview-import}

`client.spreadsheet.preview_import(...)`

**接口**：`POST /v1/spreadsheet-workshop/imports/preview`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `encoding` | query | utf-8-sig / gb18030 | 否 |
| `body` | multipart/form-data | Body_preview_spreadsheet_import | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `SpreadsheetImportPreview`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## confirm_import {#confirm-import}

`client.spreadsheet.confirm_import(...)`

**接口**：`POST /v1/spreadsheet-workshop/imports/{import_id}/confirm`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `import_id` | path | string | 是 |
| `body` | application/json | SpreadsheetImportConfirm | 是 |
| `body.accept_warnings` | 请求体 | boolean | 否 |
| `body.converter` | 请求体 | string | 是 |
| `body.request_id` | 请求体 | string | 是 |
| `body.sha256` | 请求体 | string | 是 |
| `body.title` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `SpreadsheetProject`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.spreadsheet.create_project(...)`

**接口**：`POST /v1/spreadsheet-workshop/projects`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | SpreadsheetCreate | 是 |
| `body.document` | 请求体 | SpreadsheetDocument / null | 否 |
| `body.request_id` | 请求体 | string | 是 |
| `body.title` | 请求体 | string | 否 |

**响应**：
- `200` · `application/json` · `SpreadsheetProject`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_workbook {#export-workbook}

`client.spreadsheet.export_workbook(...)`

**接口**：`POST /v1/spreadsheet-workshop/projects/{project_id}/export`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | SpreadsheetExport | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.format` | 请求体 | xlsx / csv | 否 |
| `body.sheet_id` | 请求体 | string / null | 否 |
| `body.value_mode` | 请求体 | values / formulas | 否 |

**响应**：
- `200` · `application/octet-stream` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_operations {#apply-operations}

`client.spreadsheet.apply_operations(...)`

**接口**：`POST /v1/spreadsheet-workshop/projects/{project_id}/operations`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | SpreadsheetOperations | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.operations` | 请求体 | array | 是 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `SpreadsheetProject`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_project {#update-project}

`client.spreadsheet.update_project(...)`

**接口**：`PUT /v1/spreadsheet-workshop/projects/{project_id}`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | SpreadsheetPut | 是 |
| `body.calculated` | 请求体 | boolean | 否 |
| `body.document` | 请求体 | SpreadsheetDocument | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.request_id` | 请求体 | string | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `SpreadsheetProject`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
