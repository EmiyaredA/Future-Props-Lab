<!-- docs: {"group": "api-modules", "category": "api", "order": 26, "title": "工作区与邀请方法参考", "lead": "client.workspaces 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 工作区与邀请方法参考

通过 `client.workspaces` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [revoke_invitation](#revoke-invitation) | `DELETE /v1/account/workspaces/current/invitations/{invitation_id}` |
| [delete_member](#delete-member) | `DELETE /v1/account/workspaces/current/members/{membership_id}` |
| [my_invitations](#my-invitations) | `GET /v1/account/workspace-invitations` |
| [accessible_workspaces](#accessible-workspaces) | `GET /v1/account/workspaces` |
| [workspace_invitations](#workspace-invitations) | `GET /v1/account/workspaces/current/invitations` |
| [members](#members) | `GET /v1/account/workspaces/current/members` |
| [update_workspace](#update-workspace) | `PATCH /v1/account/workspaces/current` |
| [set_member_role](#set-member-role) | `PATCH /v1/account/workspaces/current/members/{membership_id}` |
| [accept_invitation](#accept-invitation) | `POST /v1/account/workspace-invitations/{invitation_id}/accept` |
| [decline_invitation](#decline-invitation) | `POST /v1/account/workspace-invitations/{invitation_id}/decline` |
| [invite_member](#invite-member) | `POST /v1/account/workspaces/current/invitations` |
| [set_active_workspace](#set-active-workspace) | `POST /v1/account/workspaces/switch` |

## revoke_invitation {#revoke-invitation}

`client.workspaces.revoke_invitation(...)`

**接口**：`DELETE /v1/account/workspaces/current/invitations/{invitation_id}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `invitation_id` | path | string | 是 |
| `body` | application/json | WorkspaceInvitationActionIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_member {#delete-member}

`client.workspaces.delete_member(...)`

**接口**：`DELETE /v1/account/workspaces/current/members/{membership_id}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `membership_id` | path | string | 是 |
| `body` | application/json | WorkspaceMemberRemoveIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## my_invitations {#my-invitations}

`client.workspaces.my_invitations(...)`

**接口**：`GET /v1/account/workspace-invitations`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `WorkspaceInvitationListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## accessible_workspaces {#accessible-workspaces}

`client.workspaces.accessible_workspaces(...)`

**接口**：`GET /v1/account/workspaces`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `q` | query | string | 否 |
| `page` | query | integer | 否 |
| `page_size` | query | integer | 否 |

**响应**：
- `200` · `application/json` · `WorkspaceListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## workspace_invitations {#workspace-invitations}

`client.workspaces.workspace_invitations(...)`

**接口**：`GET /v1/account/workspaces/current/invitations`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `WorkspaceInvitationListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## members {#members}

`client.workspaces.members(...)`

**接口**：`GET /v1/account/workspaces/current/members`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `WorkspaceMemberListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_workspace {#update-workspace}

`client.workspaces.update_workspace(...)`

**接口**：`PATCH /v1/account/workspaces/current`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | WorkspacePatchIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.name` | 请求体 | string | 是 |
| `body.visibility` | 请求体 | private / public | 是 |

**响应**：
- `200` · `application/json` · `WorkspaceOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## set_member_role {#set-member-role}

`client.workspaces.set_member_role(...)`

**接口**：`PATCH /v1/account/workspaces/current/members/{membership_id}`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `membership_id` | path | string | 是 |
| `body` | application/json | WorkspaceMemberRoleIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.role` | 请求体 | admin / member / viewer | 是 |

**响应**：
- `200` · `application/json` · `WorkspaceMemberOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## accept_invitation {#accept-invitation}

`client.workspaces.accept_invitation(...)`

**接口**：`POST /v1/account/workspace-invitations/{invitation_id}/accept`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `invitation_id` | path | string | 是 |
| `body` | application/json | WorkspaceInvitationActionIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## decline_invitation {#decline-invitation}

`client.workspaces.decline_invitation(...)`

**接口**：`POST /v1/account/workspace-invitations/{invitation_id}/decline`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `invitation_id` | path | string | 是 |
| `body` | application/json | WorkspaceInvitationActionIn | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `204` · 无内容或由接口声明的文件响应。

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## invite_member {#invite-member}

`client.workspaces.invite_member(...)`

**接口**：`POST /v1/account/workspaces/current/invitations`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | WorkspaceInvitationCreateIn | 是 |
| `body.role` | 请求体 | admin / member / viewer | 否 |
| `body.username` | 请求体 | string | 是 |

**响应**：
- `201` · `application/json` · `WorkspaceInvitationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## set_active_workspace {#set-active-workspace}

`client.workspaces.set_active_workspace(...)`

**接口**：`POST /v1/account/workspaces/switch`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`账号治理或公开接口的专用鉴权`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | WorkspaceSwitchIn | 是 |
| `body.workspace_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `WorkspaceOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
