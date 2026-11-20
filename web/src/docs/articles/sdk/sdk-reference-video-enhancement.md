<!-- docs: {"group": "api-modules", "category": "api", "order": 28, "title": "视频增强方法参考", "lead": "client.video_enhancement 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 视频增强方法参考

通过 `client.video_enhancement` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [list_video_enhancements](#list-video-enhancements) | `GET /v1/model-inference/video-enhancements` |
| [get_video_enhancement](#get-video-enhancement) | `GET /v1/model-inference/video-enhancements/{task_id}` |
| [get_video_enhancement_result](#get-video-enhancement-result) | `GET /v1/model-inference/video-enhancements/{task_id}/content` |
| [get_video_enhancement_segment](#get-video-enhancement-segment) | `GET /v1/model-inference/video-enhancements/{task_id}/segments/{index}/{variant}` |
| [create_video_enhancement](#create-video-enhancement) | `POST /v1/model-inference/video-enhancements` |
| [control_video_enhancement](#control-video-enhancement) | `POST /v1/model-inference/video-enhancements/{task_id}/actions` |

## list_video_enhancements {#list-video-enhancements}

`client.video_enhancement.list_video_enhancements(...)`

**接口**：`GET /v1/model-inference/video-enhancements`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `model_id` | query | string | 是 |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_video_enhancement {#get-video-enhancement}

`client.video_enhancement.get_video_enhancement(...)`

**接口**：`GET /v1/model-inference/video-enhancements/{task_id}`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEnhancementOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_video_enhancement_result {#get-video-enhancement-result}

`client.video_enhancement.get_video_enhancement_result(...)`

**接口**：`GET /v1/model-inference/video-enhancements/{task_id}/content`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |

**响应**：
- `200` · `video/mp4` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_video_enhancement_segment {#get-video-enhancement-segment}

`client.video_enhancement.get_video_enhancement_segment(...)`

**接口**：`GET /v1/model-inference/video-enhancements/{task_id}/segments/{index}/{variant}`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |
| `index` | path | integer | 是 |
| `variant` | path | original / enhanced | 是 |

**响应**：
- `200` · `video/mp4` · `string`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_video_enhancement {#create-video-enhancement}

`client.video_enhancement.create_video_enhancement(...)`

**接口**：`POST /v1/model-inference/video-enhancements`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | VideoEnhancementIn | 是 |
| `body.model_id` | 请求体 | string | 是 |
| `body.request_id` | 请求体 | string | 是 |
| `body.source_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `VideoEnhancementOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## control_video_enhancement {#control-video-enhancement}

`client.video_enhancement.control_video_enhancement(...)`

**接口**：`POST /v1/model-inference/video-enhancements/{task_id}/actions`。**鉴权**：Management API Key 或 Session；按当前账号固定权限校验。
**权限**：`models.use`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `task_id` | path | string | 是 |
| `body` | application/json | VideoEnhancementAction | 是 |
| `body.action` | 请求体 | pause / resume | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `VideoEnhancementOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
