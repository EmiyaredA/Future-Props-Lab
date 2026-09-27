<!-- docs: {"group": "api-modules", "category": "api", "order": 10, "title": "Galgame 工坊方法参考", "lead": "client.galgame 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# Galgame 工坊方法参考

通过 `client.galgame` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_project](#delete-project) | `DELETE /v1/galgame-workshop/projects/{project_id}` |
| [delete_project_asset](#delete-project-asset) | `DELETE /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}` |
| [list_projects](#list-projects) | `GET /v1/galgame-workshop/projects` |
| [get_project](#get-project) | `GET /v1/galgame-workshop/projects/{project_id}` |
| [get_annotation_import](#get-annotation-import) | `GET /v1/galgame-workshop/projects/{project_id}/annotation-imports/{import_id}` |
| [list_project_assets](#list-project-assets) | `GET /v1/galgame-workshop/projects/{project_id}/assets` |
| [get_asr_settings](#get-asr-settings) | `GET /v1/galgame-workshop/projects/{project_id}/assets/asr/settings` |
| [list_transcriptions](#list-transcriptions) | `GET /v1/galgame-workshop/projects/{project_id}/assets/asr/transcriptions` |
| [get_project_asset_overview](#get-project-asset-overview) | `GET /v1/galgame-workshop/projects/{project_id}/assets/overview` |
| [get_project_package_manifest](#get-project-package-manifest) | `GET /v1/galgame-workshop/projects/{project_id}/assets/package-manifest` |
| [export_project_snapshot](#export-project-snapshot) | `GET /v1/galgame-workshop/projects/{project_id}/snapshot` |
| [get_story](#get-story) | `GET /v1/galgame-workshop/projects/{project_id}/story` |
| [preview_portrait_upgrade](#preview-portrait-upgrade) | `GET /v1/galgame-workshop/projects/{project_id}/story/portrait-upgrade` |
| [get_story_report](#get-story-report) | `GET /v1/galgame-workshop/projects/{project_id}/story/report` |
| [list_story_snapshots](#list-story-snapshots) | `GET /v1/galgame-workshop/projects/{project_id}/story/snapshots` |
| [list_handoffs](#list-handoffs) | `GET /v1/galgame-workshop/projects/{project_id}/video-editor-handoffs` |
| [get_handoff](#get-handoff) | `GET /v1/galgame-workshop/projects/{project_id}/video-editor-handoffs/{task_id}` |
| [list_video_exports](#list-video-exports) | `GET /v1/galgame-workshop/projects/{project_id}/video-exports` |
| [get_video_export](#get-video-export) | `GET /v1/galgame-workshop/projects/{project_id}/video-exports/{export_id}` |
| [download_video_export](#download-video-export) | `GET /v1/galgame-workshop/projects/{project_id}/video-exports/{export_id}/download` |
| [get_story_migration_status](#get-story-migration-status) | `GET /v1/galgame-workshop/story-migrations/status` |
| [patch_project](#patch-project) | `PATCH /v1/galgame-workshop/projects/{project_id}` |
| [patch_asr_settings](#patch-asr-settings) | `PATCH /v1/galgame-workshop/projects/{project_id}/assets/asr/settings` |
| [patch_project_asset](#patch-project-asset) | `PATCH /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}` |
| [patch_asset_transcript](#patch-asset-transcript) | `PATCH /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}/transcript` |
| [patch_story_dialogue](#patch-story-dialogue) | `PATCH /v1/galgame-workshop/projects/{project_id}/story/dialogue` |
| [patch_story_edits](#patch-story-edits) | `PATCH /v1/galgame-workshop/projects/{project_id}/story/edits` |
| [patch_story_stage_expression](#patch-story-stage-expression) | `PATCH /v1/galgame-workshop/projects/{project_id}/story/stage-expression` |
| [create_project](#create-project) | `POST /v1/galgame-workshop/projects` |
| [import_project_snapshot](#import-project-snapshot) | `POST /v1/galgame-workshop/projects/snapshot-imports` |
| [create_annotation_import](#create-annotation-import) | `POST /v1/galgame-workshop/projects/{project_id}/annotation-imports` |
| [preview_annotation_import](#preview-annotation-import) | `POST /v1/galgame-workshop/projects/{project_id}/annotation-imports/preview` |
| [upload_project_asset](#upload-project-asset) | `POST /v1/galgame-workshop/projects/{project_id}/assets` |
| [match_voice_to_dialogue](#match-voice-to-dialogue) | `POST /v1/galgame-workshop/projects/{project_id}/assets/asr/match-dialogue` |
| [create_transcriptions](#create-transcriptions) | `POST /v1/galgame-workshop/projects/{project_id}/assets/asr/transcriptions` |
| [batch_upload_project_assets](#batch-upload-project-assets) | `POST /v1/galgame-workshop/projects/{project_id}/assets/batch` |
| [preview_project_asset_import](#preview-project-asset-import) | `POST /v1/galgame-workshop/projects/{project_id}/assets/import-preview` |
| [scan_project_asset_metadata](#scan-project-asset-metadata) | `POST /v1/galgame-workshop/projects/{project_id}/assets/metadata-scan` |
| [repair_project_asset](#repair-project-asset) | `POST /v1/galgame-workshop/projects/{project_id}/assets/repair` |
| [reveal_project_folder](#reveal-project-folder) | `POST /v1/galgame-workshop/projects/{project_id}/open-folder` |
| [import_legacy_story](#import-legacy-story) | `POST /v1/galgame-workshop/projects/{project_id}/story/import` |
| [apply_story_operations](#apply-story-operations) | `POST /v1/galgame-workshop/projects/{project_id}/story/operations` |
| [apply_portrait_upgrade](#apply-portrait-upgrade) | `POST /v1/galgame-workshop/projects/{project_id}/story/portrait-upgrade` |
| [restore_story_snapshot](#restore-story-snapshot) | `POST /v1/galgame-workshop/projects/{project_id}/story/snapshots/{snapshot_id}/restore` |
| [create_handoff](#create-handoff) | `POST /v1/galgame-workshop/projects/{project_id}/video-editor-handoffs` |
| [cancel_handoff](#cancel-handoff) | `POST /v1/galgame-workshop/projects/{project_id}/video-editor-handoffs/{task_id}/cancel` |
| [create_video_export](#create-video-export) | `POST /v1/galgame-workshop/projects/{project_id}/video-exports` |
| [exact_video_export_frame](#exact-video-export-frame) | `POST /v1/galgame-workshop/projects/{project_id}/video-exports/frame` |
| [preview_video_export](#preview-video-export) | `POST /v1/galgame-workshop/projects/{project_id}/video-exports/preview` |
| [cancel_video_export](#cancel-video-export) | `POST /v1/galgame-workshop/projects/{project_id}/video-exports/{export_id}/cancel` |
| [run_story_migrations](#run-story-migrations) | `POST /v1/galgame-workshop/story-migrations/run` |
| [put_story](#put-story) | `PUT /v1/galgame-workshop/projects/{project_id}/story` |

## delete_project {#delete-project}

`client.galgame.delete_project(...)`

**接口**：`DELETE /v1/galgame-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
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

## delete_project_asset {#delete-project-asset}

`client.galgame.delete_project_asset(...)`

**接口**：`DELETE /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `asset_id` | path | string | 是 |
| `expected_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_projects {#list-projects}

`client.galgame.list_projects(...)`

**接口**：`GET /v1/galgame-workshop/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `GalgameWorkshopProjectListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project {#get-project}

`client.galgame.get_project(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameWorkshopProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_annotation_import {#get-annotation-import}

`client.galgame.get_annotation_import(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/annotation-imports/{import_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `import_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameAnnotationImportTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_project_assets {#list-project-assets}

`client.galgame.list_project_assets(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/assets`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `query` | query | string | 否 |

**响应**：
- `200` · `application/json` · `GalgameProjectAssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_asr_settings {#get-asr-settings}

`client.galgame.get_asr_settings(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/assets/asr/settings`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameAsrSettingsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_transcriptions {#list-transcriptions}

`client.galgame.list_transcriptions(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/assets/asr/transcriptions`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameTranscriptionTaskListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project_asset_overview {#get-project-asset-overview}

`client.galgame.get_project_asset_overview(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/assets/overview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameAssetOverviewOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_project_package_manifest {#get-project-package-manifest}

`client.galgame.get_project_package_manifest(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/assets/package-manifest`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgamePackageManifestOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## export_project_snapshot {#export-project-snapshot}

`client.galgame.export_project_snapshot(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/snapshot`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/zip` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_story {#get-story}

`client.galgame.get_story(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/story`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameStoryDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_portrait_upgrade {#preview-portrait-upgrade}

`client.galgame.preview_portrait_upgrade(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/story/portrait-upgrade`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgamePortraitUpgradePreviewOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_story_report {#get-story-report}

`client.galgame.get_story_report(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/story/report`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameStoryRouteReportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_story_snapshots {#list-story-snapshots}

`client.galgame.list_story_snapshots(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/story/snapshots`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_handoffs {#list-handoffs}

`client.galgame.list_handoffs(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/video-editor-handoffs`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameVideoEditorHandoffTaskListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_handoff {#get-handoff}

`client.galgame.get_handoff(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/video-editor-handoffs/{task_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameVideoEditorHandoffTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_video_exports {#list-video-exports}

`client.galgame.list_video_exports(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/video-exports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameVideoExportTaskListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_video_export {#get-video-export}

`client.galgame.get_video_export(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/video-exports/{export_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `export_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameVideoExportTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_video_export {#download-video-export}

`client.galgame.download_video_export(...)`

**接口**：`GET /v1/galgame-workshop/projects/{project_id}/video-exports/{export_id}/download`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `export_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_story_migration_status {#get-story-migration-status}

`client.galgame.get_story_migration_status(...)`

**接口**：`GET /v1/galgame-workshop/story-migrations/status`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `GalgameStoryMigrationStatusOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_project {#patch-project}

`client.galgame.patch_project(...)`

**接口**：`PATCH /v1/galgame-workshop/projects/{project_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameWorkshopProjectPatchIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.status` | 请求体 | draft / completed / null | 否 |
| `body.title` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `GalgameWorkshopProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_asr_settings {#patch-asr-settings}

`client.galgame.patch_asr_settings(...)`

**接口**：`PATCH /v1/galgame-workshop/projects/{project_id}/assets/asr/settings`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameAsrSettingsPatchIn | 是 |
| `body.concurrency` | 请求体 | integer / null | 否 |
| `body.defaultLanguage` | 请求体 | auto / zh / ja / null | 否 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.modelId` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `GalgameAsrSettingsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_project_asset {#patch-project-asset}

`client.galgame.patch_project_asset(...)`

**接口**：`PATCH /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `asset_id` | path | string | 是 |
| `body` | application/json | GalgameProjectAssetPatchIn | 是 |
| `body.category` | 请求体 | character / scene / cg / bgm / ambient / sfx / voice / video / font / other / null | 否 |
| `body.displayName` | 请求体 | string / null | 否 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.packagingPolicy` | 请求体 | auto / include / exclude / null | 否 |
| `body.virtualPath` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `GalgameProjectAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_asset_transcript {#patch-asset-transcript}

`client.galgame.patch_asset_transcript(...)`

**接口**：`PATCH /v1/galgame-workshop/projects/{project_id}/assets/{asset_id}/transcript`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `asset_id` | path | string | 是 |
| `body` | application/json | GalgameTranscriptPatchIn | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.language` | 请求体 | auto / zh / ja / null | 否 |
| `body.text` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_story_dialogue {#patch-story-dialogue}

`client.galgame.patch_story_dialogue(...)`

**接口**：`PATCH /v1/galgame-workshop/projects/{project_id}/story/dialogue`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameStoryDialoguePatchIn | 是 |
| `body.blockId` | 请求体 | string | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.expressionId` | 请求体 | string / null | 否 |
| `body.fragmentId` | 请求体 | string | 是 |
| `body.portrait` | 请求体 | GalgameStoryDialoguePortrait / null | 否 |
| `body.text` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameStoryDialoguePatchOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_story_edits {#patch-story-edits}

`client.galgame.patch_story_edits(...)`

**接口**：`PATCH /v1/galgame-workshop/projects/{project_id}/story/edits`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameStoryEditsPatchIn | 是 |
| `body.edits` | 请求体 | array | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `GalgameStoryDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_story_stage_expression {#patch-story-stage-expression}

`client.galgame.patch_story_stage_expression(...)`

**接口**：`PATCH /v1/galgame-workshop/projects/{project_id}/story/stage-expression`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameStoryStageExpressionPatchIn | 是 |
| `body.blockId` | 请求体 | string | 是 |
| `body.characterId` | 请求体 | string | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.expressionId` | 请求体 | string / null | 否 |
| `body.fragmentId` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameStoryStageExpressionPatchOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_project {#create-project}

`client.galgame.create_project(...)`

**接口**：`POST /v1/galgame-workshop/projects`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | GalgameWorkshopProjectCreateIn | 是 |
| `body.title` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameWorkshopProjectOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_project_snapshot {#import-project-snapshot}

`client.galgame.import_project_snapshot(...)`

**接口**：`POST /v1/galgame-workshop/projects/snapshot-imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_import_project_snapshot_v1_galgame_workshop_projects_snapshot_imports_post | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `GalgameProjectSnapshotImportOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_annotation_import {#create-annotation-import}

`client.galgame.create_annotation_import(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/annotation-imports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameAnnotationImportIn | 是 |
| `body.assetPrefix` | 请求体 | string | 是 |
| `body.document` | 请求体 | GalgameStoryProject | 是 |
| `body.expectedSourceRevision` | 请求体 | integer | 是 |
| `body.expectedStoryRevision` | 请求体 | integer | 是 |
| `body.language` | 请求体 | string | 否 |
| `body.masterAssetId` | 请求体 | string | 是 |
| `body.requestId` | 请求体 | string | 是 |
| `body.requirements` | 请求体 | GalgameAnnotationImportRequirements | 是 |
| `body.segmentSpeakerOverrides` | 请求体 | object | 否 |
| `body.sourceProjectId` | 请求体 | string | 是 |
| `body.speakerMap` | 请求体 | object | 是 |

**响应**：
- `202` · `application/json` · `GalgameAnnotationImportTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_annotation_import {#preview-annotation-import}

`client.galgame.preview_annotation_import(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/annotation-imports/preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameAnnotationImportIn | 是 |
| `body.assetPrefix` | 请求体 | string | 是 |
| `body.document` | 请求体 | GalgameStoryProject | 是 |
| `body.expectedSourceRevision` | 请求体 | integer | 是 |
| `body.expectedStoryRevision` | 请求体 | integer | 是 |
| `body.language` | 请求体 | string | 否 |
| `body.masterAssetId` | 请求体 | string | 是 |
| `body.requestId` | 请求体 | string | 是 |
| `body.requirements` | 请求体 | GalgameAnnotationImportRequirements | 是 |
| `body.segmentSpeakerOverrides` | 请求体 | object | 否 |
| `body.sourceProjectId` | 请求体 | string | 是 |
| `body.speakerMap` | 请求体 | object | 是 |

**响应**：
- `200` · `application/json` · `GalgameAnnotationImportPreviewOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## upload_project_asset {#upload-project-asset}

`client.galgame.upload_project_asset(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/assets`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_upload_project_asset_v1_galgame_workshop_projects__project_id__assets_post | 是 |
| `body.category` | 请求体 | character / scene / cg / bgm / ambient / sfx / voice / video / font / other / null | 否 |
| `body.upload` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `GalgameProjectAssetOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## match_voice_to_dialogue {#match-voice-to-dialogue}

`client.galgame.match_voice_to_dialogue(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/assets/asr/match-dialogue`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameVoiceMatchIn | 是 |
| `body.assetIds` | 请求体 | array / null | 否 |
| `body.blockIds` | 请求体 | array / null | 否 |
| `body.expectedStoryRevision` | 请求体 | integer | 是 |
| `body.minimumSimilarity` | 请求体 | number | 否 |

**响应**：
- `200` · `application/json` · `GalgameVoiceMatchOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_transcriptions {#create-transcriptions}

`client.galgame.create_transcriptions(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/assets/asr/transcriptions`。**鉴权**：Workspace API Key 或 Session。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameTranscriptionCreateIn | 是 |
| `body.assetIds` | 请求体 | array / null | 否 |
| `body.force` | 请求体 | boolean | 否 |
| `body.language` | 请求体 | auto / zh / ja / null | 否 |

**响应**：
- `200` · `application/json` · `GalgameTranscriptionTaskListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## batch_upload_project_assets {#batch-upload-project-assets}

`client.galgame.batch_upload_project_assets(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/assets/batch`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_batch_upload_project_assets_v1_galgame_workshop_projects__project_id__assets_batch_post | 是 |
| `body.category` | 请求体 | character / scene / cg / bgm / ambient / sfx / voice / video / font / other | 是 |
| `body.uploads` | 请求体 | array | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `GalgameAssetBatchUploadOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_project_asset_import {#preview-project-asset-import}

`client.galgame.preview_project_asset_import(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/assets/import-preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameAssetImportPreviewIn | 是 |
| `body.category` | 请求体 | character / scene / cg / bgm / ambient / sfx / voice / video / font / other | 是 |
| `body.filenames` | 请求体 | array | 是 |

**响应**：
- `200` · `application/json` · `GalgameAssetImportPreviewOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## scan_project_asset_metadata {#scan-project-asset-metadata}

`client.galgame.scan_project_asset_metadata(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/assets/metadata-scan`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameProjectAssetListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## repair_project_asset {#repair-project-asset}

`client.galgame.repair_project_asset(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/assets/repair`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameMissingAssetRepairIn | 是 |
| `body.expectedStoryRevision` | 请求体 | integer | 是 |
| `body.replacementFileId` | 请求体 | string | 是 |
| `body.storyAssetId` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameStoryDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## reveal_project_folder {#reveal-project-folder}

`client.galgame.reveal_project_folder(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/open-folder`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ProjectFolderOpenOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## import_legacy_story {#import-legacy-story}

`client.galgame.import_legacy_story(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/story/import`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | multipart/form-data | Body_import_legacy_story_v1_galgame_workshop_projects__project_id__story_import_post | 是 |
| `body.expectedRevision` | 请求体 | integer | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `GalgameStoryDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_story_operations {#apply-story-operations}

`client.galgame.apply_story_operations(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/story/operations`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameOperationsIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.operations` | 请求体 | array | 是 |
| `body.request_id` | 请求体 | string | 是 |
| `body.settings` | 请求体 | object | 否 |

**响应**：
- `200` · `application/json` · `GalgameStoryDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## apply_portrait_upgrade {#apply-portrait-upgrade}

`client.galgame.apply_portrait_upgrade(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/story/portrait-upgrade`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgamePortraitUpgradeApplyIn | 是 |
| `body.expectedStoryRevision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `GalgameStoryDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## restore_story_snapshot {#restore-story-snapshot}

`client.galgame.restore_story_snapshot(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/story/snapshots/{snapshot_id}/restore`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `snapshot_id` | path | string | 是 |
| `body` | application/json | GalgameStorySnapshotRestoreIn | 是 |
| `body.expectedStoryRevision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `GalgameStoryDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_handoff {#create-handoff}

`client.galgame.create_handoff(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/video-editor-handoffs`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameVideoEditorHandoffCreateIn | 是 |
| `body.branchSelections` | 请求体 | array | 否 |
| `body.captureFrame` | 请求体 | GalgameVideoExportCaptureFrame | 否 |
| `body.clipRange` | 请求体 | GalgameVideoExportClipRange / null | 否 |
| `body.expectedStoryRevision` | 请求体 | integer | 是 |
| `body.fragmentIds` | 请求体 | array | 否 |
| `body.locale` | 请求体 | string | 否 |
| `body.preset` | 请求体 | 1080p30 / 720p30 / 1080p60 / 720p60 | 否 |
| `body.previewFingerprint` | 请求体 | string | 是 |
| `body.requestId` | 请求体 | string | 是 |
| `body.scope` | 请求体 | route / fragments / clip | 否 |
| `body.title` | 请求体 | string / null | 否 |

**响应**：
- `202` · `application/json` · `GalgameVideoEditorHandoffTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cancel_handoff {#cancel-handoff}

`client.galgame.cancel_handoff(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/video-editor-handoffs/{task_id}/cancel`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameVideoEditorHandoffTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_video_export {#create-video-export}

`client.galgame.create_video_export(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/video-exports`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameVideoExportCreateIn | 是 |
| `body.branchSelections` | 请求体 | array | 否 |
| `body.captureFrame` | 请求体 | GalgameVideoExportCaptureFrame | 否 |
| `body.clipRange` | 请求体 | GalgameVideoExportClipRange / null | 否 |
| `body.expectedStoryRevision` | 请求体 | integer | 是 |
| `body.fragmentIds` | 请求体 | array | 否 |
| `body.locale` | 请求体 | string | 否 |
| `body.preset` | 请求体 | 1080p30 / 720p30 / 1080p60 / 720p60 | 否 |
| `body.previewFingerprint` | 请求体 | string | 是 |
| `body.requestId` | 请求体 | string | 是 |
| `body.scope` | 请求体 | route / fragments / clip | 否 |

**响应**：
- `202` · `application/json` · `GalgameVideoExportTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## exact_video_export_frame {#exact-video-export-frame}

`client.galgame.exact_video_export_frame(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/video-exports/frame`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameVideoExportFrameIn | 是 |
| `body.branchSelections` | 请求体 | array | 否 |
| `body.captureFrame` | 请求体 | GalgameVideoExportCaptureFrame | 否 |
| `body.clipRange` | 请求体 | GalgameVideoExportClipRange / null | 否 |
| `body.expectedStoryRevision` | 请求体 | integer | 是 |
| `body.fragmentIds` | 请求体 | array | 否 |
| `body.locale` | 请求体 | string | 否 |
| `body.preset` | 请求体 | 1080p30 / 720p30 / 1080p60 / 720p60 | 否 |
| `body.scope` | 请求体 | route / fragments / clip | 否 |
| `body.timeMs` | 请求体 | integer | 是 |
| `body.width` | 请求体 | integer | 否 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## preview_video_export {#preview-video-export}

`client.galgame.preview_video_export(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/video-exports/preview`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameVideoExportPreviewIn | 是 |
| `body.branchSelections` | 请求体 | array | 否 |
| `body.captureFrame` | 请求体 | GalgameVideoExportCaptureFrame | 否 |
| `body.clipRange` | 请求体 | GalgameVideoExportClipRange / null | 否 |
| `body.expectedStoryRevision` | 请求体 | integer | 是 |
| `body.fragmentIds` | 请求体 | array | 否 |
| `body.locale` | 请求体 | string | 否 |
| `body.preset` | 请求体 | 1080p30 / 720p30 / 1080p60 / 720p60 | 否 |
| `body.scope` | 请求体 | route / fragments / clip | 否 |

**响应**：
- `200` · `application/json` · `GalgameVideoExportPreviewOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cancel_video_export {#cancel-video-export}

`client.galgame.cancel_video_export(...)`

**接口**：`POST /v1/galgame-workshop/projects/{project_id}/video-exports/{export_id}/cancel`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `export_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `GalgameVideoExportTaskOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## run_story_migrations {#run-story-migrations}

`client.galgame.run_story_migrations(...)`

**接口**：`POST /v1/galgame-workshop/story-migrations/run`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | GalgameStoryMigrationRunIn | 是 |
| `body.limit` | 请求体 | integer | 否 |

**响应**：
- `200` · `application/json` · `GalgameStoryMigrationRunOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_story {#put-story}

`client.galgame.put_story(...)`

**接口**：`PUT /v1/galgame-workshop/projects/{project_id}/story`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |
| `body` | application/json | GalgameStoryDocumentPutIn | 是 |
| `body.document` | 请求体 | GalgameStoryProject | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `GalgameStoryDocumentOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
