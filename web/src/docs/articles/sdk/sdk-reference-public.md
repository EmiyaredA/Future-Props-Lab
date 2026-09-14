<!-- docs: {"group": "api-modules", "category": "api", "order": 15, "title": "公开展台方法参考", "lead": "client.public 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 公开展台方法参考

通过 `client.public` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [projection](#projection) | `GET /v1/public-workspace` |
| [asset_content](#asset-content) | `GET /v1/public-workspace/assets/{asset_id}/content` |
| [story](#story) | `GET /v1/public-workspace/galgame-projects/{project_id}/story` |

## projection {#projection}

`client.public.projection(...)`

**接口**：`GET /v1/public-workspace`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `PublicWorkspaceProjectionOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## asset_content {#asset-content}

`client.public.asset_content(...)`

**接口**：`GET /v1/public-workspace/assets/{asset_id}/content`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `asset_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## story {#story}

`client.public.story(...)`

**接口**：`GET /v1/public-workspace/galgame-projects/{project_id}/story`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `project_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `PublicGalgameStoryOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
