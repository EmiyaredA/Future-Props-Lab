<!-- docs: {"group": "api-modules", "category": "api", "order": 29, "title": "工具导航方法参考", "lead": "client.tools 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 工具导航方法参考

通过 `client.tools` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [get_codex_source](#get-codex-source) | `GET /v1/tool-navigation/codex-source` |
| [get_state](#get-state) | `GET /v1/tool-navigation/state` |
| [get_storage_usage](#get-storage-usage) | `GET /v1/tool-navigation/storage-usage` |
| [get_video_download_deps](#get-video-download-deps) | `GET /v1/tool-navigation/video-download/deps` |
| [get_video_download_job](#get-video-download-job) | `GET /v1/tool-navigation/video-download/jobs/{job_id}` |
| [download_video_download_file](#download-video-download-file) | `GET /v1/tool-navigation/video-download/jobs/{job_id}/file` |
| [set_favorite](#set-favorite) | `PATCH /v1/tool-navigation/tools/{tool_id}` |
| [post_codex_source_restore](#post-codex-source-restore) | `POST /v1/tool-navigation/codex-source/restore` |
| [analyze_storage_directory](#analyze-storage-directory) | `POST /v1/tool-navigation/storage-usage/analyze` |
| [open_storage_directory](#open-storage-directory) | `POST /v1/tool-navigation/storage-usage/open-directory` |
| [record_use](#record-use) | `POST /v1/tool-navigation/tools/{tool_id}/use` |
| [post_video_download_job](#post-video-download-job) | `POST /v1/tool-navigation/video-download/jobs` |
| [put_codex_source](#put-codex-source) | `PUT /v1/tool-navigation/codex-source` |

## get_codex_source {#get-codex-source}

`client.tools.get_codex_source(...)`

**接口**：`GET /v1/tool-navigation/codex-source`。**鉴权**：仅桌面模式；平台管理员 Session；不接受 Management API Key 或 Agent 通道。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `CodexSourceState`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_state {#get-state}

`client.tools.get_state(...)`

**接口**：`GET /v1/tool-navigation/state`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ToolNavigationStateOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_storage_usage {#get-storage-usage}

`client.tools.get_storage_usage(...)`

**接口**：`GET /v1/tool-navigation/storage-usage`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `directory` | query | string / null | 否 |

**响应**：
- `200` · `application/json` · `StorageUsageState`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_video_download_deps {#get-video-download-deps}

`client.tools.get_video_download_deps(...)`

**接口**：`GET /v1/tool-navigation/video-download/deps`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `VideoDownloadDepsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_video_download_job {#get-video-download-job}

`client.tools.get_video_download_job(...)`

**接口**：`GET /v1/tool-navigation/video-download/jobs/{job_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `job_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoDownloadJobOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## download_video_download_file {#download-video-download-file}

`client.tools.download_video_download_file(...)`

**接口**：`GET /v1/tool-navigation/video-download/jobs/{job_id}/file`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `job_id` | path | string | 是 |

**响应**：
- `200` · `application/octet-stream` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## set_favorite {#set-favorite}

`client.tools.set_favorite(...)`

**接口**：`PATCH /v1/tool-navigation/tools/{tool_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `tool_id` | path | string | 是 |
| `body` | application/json | ToolFavoriteIn | 是 |
| `body.is_favorite` | 请求体 | boolean | 是 |

**响应**：
- `200` · `application/json` · `ToolNavigationItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## post_codex_source_restore {#post-codex-source-restore}

`client.tools.post_codex_source_restore(...)`

**接口**：`POST /v1/tool-navigation/codex-source/restore`。**鉴权**：仅桌面模式；平台管理员 Session；不接受 Management API Key 或 Agent 通道。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | CodexSourceRestore | 是 |
| `body.expected_revision` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `CodexSourceState`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## analyze_storage_directory {#analyze-storage-directory}

`client.tools.analyze_storage_directory(...)`

**接口**：`POST /v1/tool-navigation/storage-usage/analyze`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | StorageDirectoryIn | 是 |
| `body.directory` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `StorageOpenReceipt`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## open_storage_directory {#open-storage-directory}

`client.tools.open_storage_directory(...)`

**接口**：`POST /v1/tool-navigation/storage-usage/open-directory`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | StorageDirectoryIn | 是 |
| `body.directory` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `StorageOpenReceipt`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## record_use {#record-use}

`client.tools.record_use(...)`

**接口**：`POST /v1/tool-navigation/tools/{tool_id}/use`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `tool_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `ToolNavigationItemOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## post_video_download_job {#post-video-download-job}

`client.tools.post_video_download_job(...)`

**接口**：`POST /v1/tool-navigation/video-download/jobs`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.write`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | VideoDownloadJobCreate | 是 |
| `body.cookies_from_browser` | 请求体 | string | 否 |
| `body.folder_id` | 请求体 | string / null | 否 |
| `body.quality` | 请求体 | string | 否 |
| `body.save_to_disk` | 请求体 | boolean | 否 |
| `body.save_to_library` | 请求体 | boolean | 否 |
| `body.url` | 请求体 | string | 是 |
| `body.use_browser_cookies` | 请求体 | boolean | 否 |

**响应**：
- `200` · `application/json` · `VideoDownloadJobOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_codex_source {#put-codex-source}

`client.tools.put_codex_source(...)`

**接口**：`PUT /v1/tool-navigation/codex-source`。**鉴权**：仅桌面模式；平台管理员 Session；不接受 Management API Key 或 Agent 通道。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | CodexSourceUpdate | 是 |
| `body.base_url` | 请求体 | string | 否 |
| `body.env_key` | 请求体 | string | 否 |
| `body.expected_revision` | 请求体 | string | 是 |
| `body.model` | 请求体 | string | 否 |
| `body.source` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `CodexSourceState`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
