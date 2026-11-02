<!-- docs: {"group": "api-modules", "category": "api", "order": 0, "title": "登录与个人账号方法参考", "lead": "client.accounts 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 登录与个人账号方法参考

通过 `client.accounts` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_api_key](#delete-api-key) | `DELETE /v1/account/api-keys/{key_id}` |
| [remove_avatar](#remove-avatar) | `DELETE /v1/account/profile/avatar` |
| [delete_session](#delete-session) | `DELETE /v1/account/sessions/{session_id}` |
| [api_keys](#api-keys) | `GET /v1/account/api-keys` |
| [directory](#directory) | `GET /v1/account/directory` |
| [get_profile](#get-profile) | `GET /v1/account/profile` |
| [get_avatar](#get-avatar) | `GET /v1/account/profile/avatar` |
| [own_audit](#own-audit) | `GET /v1/account/security-events` |
| [sessions](#sessions) | `GET /v1/account/sessions` |
| [me](#me) | `GET /v1/auth/me` |
| [patch_profile](#patch-profile) | `PATCH /v1/account/profile` |
| [add_api_key](#add-api-key) | `POST /v1/account/api-keys` |
| [renew_api_key](#renew-api-key) | `POST /v1/account/api-keys/{key_id}/renew` |
| [remove_api_key](#remove-api-key) | `POST /v1/account/api-keys/{key_id}/revoke` |
| [delete_other_sessions](#delete-other-sessions) | `POST /v1/account/sessions/revoke-others` |
| [change_current_password](#change-current-password) | `POST /v1/auth/change-password` |
| [login](#login) | `POST /v1/auth/login` |
| [logout](#logout) | `POST /v1/auth/logout` |
| [reauth](#reauth) | `POST /v1/auth/reauth` |
| [put_avatar](#put-avatar) | `PUT /v1/account/profile/avatar` |

## delete_api_key {#delete-api-key}

`client.accounts.delete_api_key(...)`

**接口**：`DELETE /v1/account/api-keys/{key_id}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `key_id` | path | string | 是 |
| `body` | application/json | DeleteApiKeyIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## remove_avatar {#remove-avatar}

`client.accounts.remove_avatar(...)`

**接口**：`DELETE /v1/account/profile/avatar`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | AccountAvatarDeleteIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `CurrentUserOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_session {#delete-session}

`client.accounts.delete_session(...)`

**接口**：`DELETE /v1/account/sessions/{session_id}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `session_id` | path | string | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## api_keys {#api-keys}

`client.accounts.api_keys(...)`

**接口**：`GET /v1/account/api-keys`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## directory {#directory}

`client.accounts.directory(...)`

**接口**：`GET /v1/account/directory`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `q` | query | string | 否 |
| `limit` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `AccountDirectoryOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_profile {#get-profile}

`client.accounts.get_profile(...)`

**接口**：`GET /v1/account/profile`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `CurrentUserOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_avatar {#get-avatar}

`client.accounts.get_avatar(...)`

**接口**：`GET /v1/account/profile/avatar`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `size` | query | 128 / 320 / 640 / 1280 / null | 否 |

**响应**：
- `200` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## own_audit {#own-audit}

`client.accounts.own_audit(...)`

**接口**：`GET /v1/account/security-events`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |
| `event_type` | query | string | 否 |
| `outcome` | query | string | 否 |

**响应**：
- `200` · `application/json` · `SecurityAuditListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## sessions {#sessions}

`client.accounts.sessions(...)`

**接口**：`GET /v1/account/sessions`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `AccountSessionListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## me {#me}

`client.accounts.me(...)`

**接口**：`GET /v1/auth/me`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `AuthMeOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## patch_profile {#patch-profile}

`client.accounts.patch_profile(...)`

**接口**：`PATCH /v1/account/profile`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | AccountProfilePatchIn | 是 |
| `body.display_name` | 请求体 | string / null | 否 |
| `body.email` | 请求体 | string / null | 否 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `CurrentUserOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## add_api_key {#add-api-key}

`client.accounts.add_api_key(...)`

**接口**：`POST /v1/account/api-keys`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ApiKeyCreateIn | 是 |
| `body.expires_in_days` | 请求体 | integer | 否 |
| `body.name` | 请求体 | string | 是 |
| `body.scopes` | 请求体 | array | 是 |

**响应**：
- `201` · `application/json` · `ApiKeyCreatedOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## renew_api_key {#renew-api-key}

`client.accounts.renew_api_key(...)`

**接口**：`POST /v1/account/api-keys/{key_id}/renew`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `key_id` | path | string | 是 |
| `body` | application/json | RenewApiKeyIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.expires_in_days` | 请求体 | integer | 否 |

**响应**：
- `200` · `application/json` · `ApiKeyOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## remove_api_key {#remove-api-key}

`client.accounts.remove_api_key(...)`

**接口**：`POST /v1/account/api-keys/{key_id}/revoke`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `key_id` | path | string | 是 |
| `body` | application/json | RevokeApiKeyIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `ApiKeyOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_other_sessions {#delete-other-sessions}

`client.accounts.delete_other_sessions(...)`

**接口**：`POST /v1/account/sessions/revoke-others`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `object`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## change_current_password {#change-current-password}

`client.accounts.change_current_password(...)`

**接口**：`POST /v1/auth/change-password`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ChangePasswordIn | 是 |
| `body.current_password` | 请求体 | string | 是 |
| `body.new_password` | 请求体 | string | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## login {#login}

`client.accounts.login(...)`

**接口**：`POST /v1/auth/login`。**鉴权**：账号密码。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | LoginIn | 是 |
| `body.password` | 请求体 | string | 是 |
| `body.username` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `AuthMeOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## logout {#logout}

`client.accounts.logout(...)`

**接口**：`POST /v1/auth/logout`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## reauth {#reauth}

`client.accounts.reauth(...)`

**接口**：`POST /v1/auth/reauth`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ReauthIn | 是 |
| `body.password` | 请求体 | string | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## put_avatar {#put-avatar}

`client.accounts.put_avatar(...)`

**接口**：`PUT /v1/account/profile/avatar`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | multipart/form-data | Body_put_avatar_v1_account_profile_avatar_put | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.file` | 请求体 | string | 是 |

文件通过 `files={字段名: (文件名, 二进制文件对象, MIME)}` 传入；其他表单字段放在 `body`。

**响应**：
- `200` · `application/json` · `CurrentUserOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
