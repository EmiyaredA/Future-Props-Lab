<!-- docs: {"group": "api-modules", "category": "api", "order": 1, "title": "账号管理方法参考", "lead": "client.admin 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 账号管理方法参考

通过 `client.admin` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [accounts](#accounts) | `GET /v1/platform/accounts` |
| [audit_v1_platform_security_events](#audit-v1-platform-security-events) | `GET /v1/platform/security-events` |
| [patch_account](#patch-account) | `PATCH /v1/platform/accounts/{user_id}` |
| [add_account](#add-account) | `POST /v1/platform/accounts` |
| [reset_password](#reset-password) | `POST /v1/platform/accounts/{user_id}/reset-password` |

## accounts {#accounts}

`client.admin.accounts(...)`

**接口**：`GET /v1/platform/accounts`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `q` | query | string | 否 |
| `status` | query | string | 否 |
| `is_platform_admin` | query | boolean / null | 否 |
| `platform_role` | query | string | 否 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `AccountListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## audit_v1_platform_security_events {#audit-v1-platform-security-events}

`client.admin.audit_v1_platform_security_events(...)`

**接口**：`GET /v1/platform/security-events`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |
| `event_type` | query | string | 否 |
| `outcome` | query | string | 否 |
| `actor_query` | query | string | 否 |
| `target_query` | query | string | 否 |
| `from_date` | query | string / null | 否 |
| `to_date` | query | string / null | 否 |

**响应**：
- `200` · `application/json` · `SecurityAuditListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_account {#patch-account}

`client.admin.patch_account(...)`

**接口**：`PATCH /v1/platform/accounts/{user_id}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `user_id` | path | string | 是 |
| `body` | application/json | AccountPatchIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.is_platform_admin` | 请求体 | boolean / null | 否 |
| `body.platform_role` | 请求体 | admin / user / null | 否 |
| `body.status` | 请求体 | active / disabled / null | 否 |

**响应**：
- `200` · `application/json` · `AccountOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## add_account {#add-account}

`client.admin.add_account(...)`

**接口**：`POST /v1/platform/accounts`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | AccountCreateIn | 是 |
| `body.display_name` | 请求体 | string | 否 |
| `body.email` | 请求体 | string / null | 否 |
| `body.is_platform_admin` | 请求体 | boolean | 否 |
| `body.platform_role` | 请求体 | admin / user / null | 否 |
| `body.username` | 请求体 | string | 是 |

**响应**：
- `201` · `application/json` · `AccountCreatedOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## reset_password {#reset-password}

`client.admin.reset_password(...)`

**接口**：`POST /v1/platform/accounts/{user_id}/reset-password`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `user_id` | path | string | 是 |
| `body` | application/json | AccountResetPasswordIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `ResetPasswordOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
