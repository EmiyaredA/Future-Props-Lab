<!-- docs: {"group": "api-modules", "category": "api", "order": 3, "title": "录音标注方法参考", "lead": "client.annotation 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 录音标注方法参考

通过 `client.annotation` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_project](#delete-project) | `DELETE /v1/audio-annotation/projects/{project_id}` |
| [list_projects](#list-projects) | `GET /v1/audio-annotation/projects` |
| [get_project](#get-project) | `GET /v1/audio-annotation/projects/{project_id}` |
| [get_document](#get-document) | `GET /v1/audio-annotation/projects/{project_id}/document` |
| [export_annotation](#export-annotation) | `GET /v1/audio-annotation/projects/{project_id}/export` |
| [download_segment_audio](#download-segment-audio) | `GET /v1/audio-annotation/projects/{project_id}/segments/{segment_id}/audio` |
| [get_waveform](#get-waveform) | `GET /v1/audio-annotation/projects/{project_id}/waveform` |
| [patch_project](#patch-project) | `PATCH /v1/audio-annotation/projects/{project_id}` |
| [import_project](#import-project) | `POST /v1/audio-annotation/imports` |
| [create_project](#create-project) | `POST /v1/audio-annotation/projects` |
| [apply_annotation_operations](#apply-annotation-operations) | `POST /v1/audio-annotation/projects/{project_id}/document/operations` |
| [transcribe_segment](#transcribe-segment) | `POST /v1/audio-annotation/projects/{project_id}/segment-transcriptions` |
| [transcribe_saved_segment](#transcribe-saved-segment) | `POST /v1/audio-annotation/projects/{project_id}/segments/{segment_id}/transcribe-saved` |
| [import_transcription](#import-transcription) | `POST /v1/audio-annotation/transcription-imports` |
| [put_document](#put-document) | `PUT /v1/audio-annotation/projects/{project_id}/document` |
| [put_waveform](#put-waveform) | `PUT /v1/audio-annotation/projects/{project_id}/waveform` |

## delete_project {#delete-project}

`client.annotation.delete_project(...)`

**接口**：`DELETE /v1/audio-annotation/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
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

## list_projects {#list-projects}

`client.annotation.list_projects(...)`

**接口**：`GET /v1/audio-annotation/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `query` | query | string | 否 |

**响应**：
- `200` · `application/json` · `AudioAnnotationProjectListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.annotation.get_project(...)`

**接口**：`GET /v1/audio-annotation/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `AudioAnnotationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_document {#get-document}

`client.annotation.get_document(...)`

**接口**：`GET /v1/audio-annotation/projects/{project_id}/document`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `AudioAnnotationDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_annotation {#export-annotation}

`client.annotation.export_annotation(...)`

**接口**：`GET /v1/audio-annotation/projects/{project_id}/export`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |
| `format` | query | json / srt | 否 |

**响应**：
- `200` · `application/octet-stream` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_segment_audio {#download-segment-audio}

`client.annotation.download_segment_audio(...)`

**接口**：`GET /v1/audio-annotation/projects/{project_id}/segments/{segment_id}/audio`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `segment_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/octet-stream` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_waveform {#get-waveform}

`client.annotation.get_waveform(...)`

**接口**：`GET /v1/audio-annotation/projects/{project_id}/waveform`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `AudioAnnotationWaveformOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_project {#patch-project}

`client.annotation.patch_project(...)`

**接口**：`PATCH /v1/audio-annotation/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | AudioAnnotationProjectPatchIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `AudioAnnotationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_project {#import-project}

`client.annotation.import_project(...)`

**接口**：`POST /v1/audio-annotation/imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | AudioAnnotationImportIn | 是 |
| `body.asset_id` | 请求体 | string | 是 |
| `body.custom_emotions` | 请求体 | array | 否 |
| `body.schema_version` | 请求体 | string | 否 |
| `body.segments` | 请求体 | array | 否 |
| `body.speakers` | 请求体 | array | 否 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `AudioAnnotationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.annotation.create_project(...)`

**接口**：`POST /v1/audio-annotation/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | AudioAnnotationProjectCreateIn | 是 |
| `body.asset_id` | 请求体 | string | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `AudioAnnotationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_annotation_operations {#apply-annotation-operations}

`client.annotation.apply_annotation_operations(...)`

**接口**：`POST /v1/audio-annotation/projects/{project_id}/document/operations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | AnnotationOperationsIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.operations` | 请求体 | array | 是 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `AudioAnnotationDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## transcribe_segment {#transcribe-segment}

`client.annotation.transcribe_segment(...)`

**接口**：`POST /v1/audio-annotation/projects/{project_id}/segment-transcriptions`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_transcribe_segment_v1_audio_annotation_projects__project_id__segment_transcriptions_post | 是 |
| `body.end_ms` | 请求体 | integer | 是 |
| `body.language_tag` | 请求体 | string / null | 否 |
| `body.model_id` | 请求体 | string | 是 |
| `body.segment_id` | 请求体 | string | 是 |
| `body.start_ms` | 请求体 | integer | 是 |
| `body.target_language_tag` | 请求体 | string / null | 否 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `AudioAnnotationSegmentTranscriptionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## transcribe_saved_segment {#transcribe-saved-segment}

`client.annotation.transcribe_saved_segment(...)`

**接口**：`POST /v1/audio-annotation/projects/{project_id}/segments/{segment_id}/transcribe-saved`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `segment_id` | path | string | 是 |
| `body` | application/json | SavedSegmentTranscriptionIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.language` | 请求体 | string / null | 否 |
| `body.model_id` | 请求体 | string | 是 |
| `body.target_language` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `AudioAnnotationSegmentTranscriptionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_transcription {#import-transcription}

`client.annotation.import_transcription(...)`

**接口**：`POST /v1/audio-annotation/transcription-imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | AudioAnnotationTranscriptionTaskImportIn / AudioAnnotationTranscriptionJsonImportIn | 是 |

**响应**：
- `200` · `application/json` · `AudioAnnotationProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_document {#put-document}

`client.annotation.put_document(...)`

**接口**：`PUT /v1/audio-annotation/projects/{project_id}/document`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | AudioAnnotationDocumentPutIn | 是 |
| `body.custom_emotions` | 请求体 | array | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.schema_version` | 请求体 | string | 否 |
| `body.segments` | 请求体 | array | 否 |
| `body.speakers` | 请求体 | array | 否 |

**响应**：
- `200` · `application/json` · `AudioAnnotationDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_waveform {#put-waveform}

`client.annotation.put_waveform(...)`

**接口**：`PUT /v1/audio-annotation/projects/{project_id}/waveform`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | AudioAnnotationWaveformPutIn | 是 |
| `body.duration_ms` | 请求体 | integer | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.peaks` | 请求体 | array | 是 |

**响应**：
- `200` · `application/json` · `AudioAnnotationWaveformOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
