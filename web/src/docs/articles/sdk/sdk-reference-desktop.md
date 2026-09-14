<!-- docs: {"group": "api-modules", "category": "api", "order": 5, "title": "桌面首次初始化方法参考", "lead": "client.desktop 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 桌面首次初始化方法参考

通过 `client.desktop` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [get_setup](#get-setup) | `GET /v1/desktop/setup` |
| [create_first_account](#create-first-account) | `POST /v1/desktop/setup` |

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
