<!-- docs: {"group": "api-modules", "category": "api", "order": 9, "title": "平台治理方法参考", "lead": "client.governance 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 平台治理方法参考

通过 `client.governance` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [cross_logs](#cross-logs) | `GET /v1/account/cross-workspace-call-logs` |
| [cross_log_stats](#cross-log-stats) | `GET /v1/account/cross-workspace-call-logs/stats` |
| [developer_docs](#developer-docs) | `GET /v1/account/developer-documents` |
| [log_spaces](#log-spaces) | `GET /v1/account/log-workspaces` |
| [get_policy](#get-policy) | `GET /v1/platform/permission-policy` |
| [invites](#invites) | `GET /v1/platform/registration-invite-codes` |
| [redemptions](#redemptions) | `GET /v1/platform/registration-invite-codes/{invite_id}/redemptions` |
| [get_quotas](#get-quotas) | `GET /v1/platform/runtime-quotas` |
| [certification](#certification) | `PATCH /v1/account/project-certification/{kind}/{project_id}` |
| [patch_policy](#patch-policy) | `PATCH /v1/platform/permission-policy` |
| [patch_invite](#patch-invite) | `PATCH /v1/platform/registration-invite-codes/{invite_id}` |
| [patch_quotas](#patch-quotas) | `PATCH /v1/platform/runtime-quotas` |
| [registration](#registration) | `POST /v1/auth/register` |
| [add_invite](#add-invite) | `POST /v1/platform/registration-invite-codes` |
| [invite_action](#invite-action) | `POST /v1/platform/registration-invite-codes/{invite_id}/actions` |
| [invite_secret](#invite-secret) | `POST /v1/platform/registration-invite-codes/{invite_id}/secret` |

## cross_logs {#cross-logs}

`client.governance.cross_logs(...)`

**接口**：`GET /v1/account/cross-workspace-call-logs`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`logs.cross_workspace`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `q` | query | string | 否 |
| `call_source` | query | string | 否 |
| `provider_kind` | query | string | 否 |
| `model` | query | string | 否 |
| `api_key_id` | query | string | 否 |
| `status` | query | string | 否 |
| `from` | query | string / null | 否 |
| `to` | query | string / null | 否 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |
| `workspace_ids` | query | array | 否 |

**响应**：
- `200` · `application/json` · `CrossWorkspaceLogPage`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## cross_log_stats {#cross-log-stats}

`client.governance.cross_log_stats(...)`

**接口**：`GET /v1/account/cross-workspace-call-logs/stats`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`logs.cross_workspace`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `workspace_ids` | query | array | 否 |

**响应**：
- `200` · `application/json` · `CallLogStatsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## developer_docs {#developer-docs}

`client.governance.developer_docs(...)`

**接口**：`GET /v1/account/developer-documents`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `DeveloperDocumentsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## log_spaces {#log-spaces}

`client.governance.log_spaces(...)`

**接口**：`GET /v1/account/log-workspaces`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`logs.cross_workspace`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_policy {#get-policy}

`client.governance.get_policy(...)`

**接口**：`GET /v1/platform/permission-policy`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `PermissionPolicyOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## invites {#invites}

`client.governance.invites(...)`

**接口**：`GET /v1/platform/registration-invite-codes`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `q` | query | string | 否 |
| `status` | query | string | 否 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `RegistrationInvitePage`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## redemptions {#redemptions}

`client.governance.redemptions(...)`

**接口**：`GET /v1/platform/registration-invite-codes/{invite_id}/redemptions`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `invite_id` | path | string | 是 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `RedemptionPage`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_quotas {#get-quotas}

`client.governance.get_quotas(...)`

**接口**：`GET /v1/platform/runtime-quotas`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `RuntimeQuotasOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## certification {#certification}

`client.governance.certification(...)`

**接口**：`PATCH /v1/account/project-certification/{kind}/{project_id}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `kind` | path | visual / galgame | 是 |
| `project_id` | path | string | 是 |
| `body` | application/json | CertificationIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.is_official` | 请求体 | boolean | 是 |

**响应**：
- `200` · `application/json` · `CertificationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_policy {#patch-policy}

`client.governance.patch_policy(...)`

**接口**：`PATCH /v1/platform/permission-policy`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | PermissionPolicyIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.value` | 请求体 | PermissionPolicy | 是 |

**响应**：
- `200` · `application/json` · `PermissionPolicyOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_invite {#patch-invite}

`client.governance.patch_invite(...)`

**接口**：`PATCH /v1/platform/registration-invite-codes/{invite_id}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `invite_id` | path | string | 是 |
| `body` | application/json | RegistrationInvitePatch | 是 |
| `body.enabled` | 请求体 | boolean / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.max_uses` | 请求体 | integer / null | 否 |

**响应**：
- `200` · `application/json` · `RegistrationInviteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_quotas {#patch-quotas}

`client.governance.patch_quotas(...)`

**接口**：`PATCH /v1/platform/runtime-quotas`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | RuntimeQuotasIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.value` | 请求体 | RuntimeQuotas | 是 |

**响应**：
- `200` · `application/json` · `RuntimeQuotasOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## registration {#registration}

`client.governance.registration(...)`

**接口**：`POST /v1/auth/register`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | RegistrationIn | 是 |
| `body.display_name` | 请求体 | string | 否 |
| `body.email` | 请求体 | string / null | 否 |
| `body.invite_code` | 请求体 | string | 是 |
| `body.password` | 请求体 | string | 是 |
| `body.username` | 请求体 | string | 是 |

**响应**：
- `201` · `application/json` · `AuthMeOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## add_invite {#add-invite}

`client.governance.add_invite(...)`

**接口**：`POST /v1/platform/registration-invite-codes`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | RegistrationInviteIn | 是 |
| `body.max_uses` | 请求体 | integer | 否 |
| `body.name` | 请求体 | string | 是 |
| `body.validity_days` | 请求体 | integer | 否 |

**响应**：
- `201` · `application/json` · `RegistrationInviteCreated`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## invite_action {#invite-action}

`client.governance.invite_action(...)`

**接口**：`POST /v1/platform/registration-invite-codes/{invite_id}/actions`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `invite_id` | path | string | 是 |
| `body` | application/json | RegistrationInviteAction | 是 |
| `body.action` | 请求体 | extend / reset_expiry / delete | 是 |
| `body.days` | 请求体 | integer | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `RegistrationInviteOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## invite_secret {#invite-secret}

`client.governance.invite_secret(...)`

**接口**：`POST /v1/platform/registration-invite-codes/{invite_id}/secret`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `invite_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `SecretOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
