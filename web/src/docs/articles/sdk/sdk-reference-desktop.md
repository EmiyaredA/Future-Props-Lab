<!-- docs: {"group": "api-modules", "category": "api", "order": 7, "title": "桌面初始化与本地 Agent 接入方法参考", "lead": "client.desktop 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 桌面初始化与本地 Agent 接入方法参考

通过 `client.desktop` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [capabilities](#capabilities) | `GET /v1/desktop/agent/capabilities` |
| [pending_pairings](#pending-pairings) | `GET /v1/desktop/agent/pairings` |
| [get_setup](#get-setup) | `GET /v1/desktop/setup` |
| [inbox](#inbox) | `GET /v1/desktop/ui/inbox` |
| [open_status](#open-status) | `GET /v1/desktop/ui/requests/{request_id}` |
| [begin_pairing](#begin-pairing) | `POST /v1/desktop/agent/pairings` |
| [claim_pairing](#claim-pairing) | `POST /v1/desktop/agent/pairings/{pair_id}/claim` |
| [decide_pairing](#decide-pairing) | `POST /v1/desktop/agent/pairings/{pair_id}/decision` |
| [create_first_account](#create-first-account) | `POST /v1/desktop/setup` |
| [open_in_app](#open-in-app) | `POST /v1/desktop/ui/open` |
| [acknowledge](#acknowledge) | `POST /v1/desktop/ui/requests/{request_id}/ack` |

## capabilities {#capabilities}

`client.desktop.capabilities(...)`

**接口**：`GET /v1/desktop/agent/capabilities`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `AgentCapabilities`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## pending_pairings {#pending-pairings}

`client.desktop.pending_pairings(...)`

**接口**：`GET /v1/desktop/agent/pairings`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `array`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## get_setup {#get-setup}

`client.desktop.get_setup(...)`

**接口**：`GET /v1/desktop/setup`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `DesktopSetupOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## inbox {#inbox}

`client.desktop.inbox(...)`

**接口**：`GET /v1/desktop/ui/inbox`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `DesktopInbox`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## open_status {#open-status}

`client.desktop.open_status(...)`

**接口**：`GET /v1/desktop/ui/requests/{request_id}`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `request_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `DesktopOpenOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## begin_pairing {#begin-pairing}

`client.desktop.begin_pairing(...)`

**接口**：`POST /v1/desktop/agent/pairings`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | AgentPairIn | 是 |
| `body.name` | 请求体 | string | 是 |
| `body.scope` | 请求体 | studio:read / studio:write | 否 |

**响应**：
- `201` · `application/json` · `AgentPairStarted`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## claim_pairing {#claim-pairing}

`client.desktop.claim_pairing(...)`

**接口**：`POST /v1/desktop/agent/pairings/{pair_id}/claim`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `pair_id` | path | string | 是 |
| `body` | application/json | AgentClaimIn | 是 |
| `body.claim_token` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `AgentClaimOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## decide_pairing {#decide-pairing}

`client.desktop.decide_pairing(...)`

**接口**：`POST /v1/desktop/agent/pairings/{pair_id}/decision`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `pair_id` | path | string | 是 |
| `body` | application/json | AgentDecisionIn | 是 |
| `body.approve` | 请求体 | boolean | 是 |
| `body.code` | 请求体 | string | 是 |
| `body.expected_workspace_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `AgentPairOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_first_account {#create-first-account}

`client.desktop.create_first_account(...)`

**接口**：`POST /v1/desktop/setup`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | DesktopSetupIn | 是 |
| `body.display_name` | 请求体 | string | 否 |
| `body.password` | 请求体 | string | 是 |
| `body.username` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `DesktopSetupOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## open_in_app {#open-in-app}

`client.desktop.open_in_app(...)`

**接口**：`POST /v1/desktop/ui/open`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | DesktopOpenIn | 是 |
| `body.kind` | 请求体 | visual / galgame / video / presentation / annotation / director / note / knowledge / skill / tool-api / mcp | 是 |
| `body.resource_id` | 请求体 | string / null | 否 |
| `body.view` | 请求体 | list / details / upload / versions / tags / edit / validate / tools / null | 否 |

**响应**：
- `202` · `application/json` · `DesktopOpenOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## acknowledge {#acknowledge}

`client.desktop.acknowledge(...)`

**接口**：`POST /v1/desktop/ui/requests/{request_id}/ack`。**鉴权**：仅桌面模式；私有启动凭据；创建账号须同源且尚未初始化。
**权限**：`desktop.bootstrap`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `request_id` | path | string | 是 |
| `body` | application/json | DesktopOpenAck | 是 |
| `body.status` | 请求体 | waiting_confirmation / opened / cancelled / unavailable | 是 |

**响应**：
- `200` · `application/json` · `DesktopOpenOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
