# Agent Note: 接入管理侧栏按 kind 呈现协议类型

Status: implemented

## Problem

接入管理曾用可自由命名的 `supplier` 分组，并提供「按接入协议整理」把未归类连接批量写入 `supplier_id`。这要求用户再点一次按钮，且整理会对连接做整包 `PATCH`，存量 `base_url` 若不符合当前 URL 校验会落到「请求参数无效」。协议类型本应就是接入协议（`kind`）的呈现，不应再叠一层可 CRUD 的分组树。

## Decision

接入管理侧栏与目录「协议类型」筛选直接按 `provider.kind` 分组/过滤，展示名复用 `providerKindLabel`。去掉整理按钮、侧栏协议类型增删改，以及连接表单上的「所属协议类型」。新建连接以 `supplier_id: null` 提交；`model_suppliers` API 仍保留但不驱动主路径 UI。

## Alternatives considered

- **进入页面时静默自动 PATCH 归类** — 能去掉按钮，但仍会踩存量地址校验 422，且在用户未预期时改写目录 revision。
- **继续用 supplier 分组 + 仅修整理接口** — 可修报错，但协议类型与 `kind` 仍双重概念，用户仍要维护自由分组。

## Consequences

- **收益**：侧栏即协议类型，无额外整理步骤；不再触发整理链路的参数无效错误。
- **代价与已知上限**：自由命名供应商分组在工作区接入管理中不可见；模板/API 仍可带 `suppliers`，与侧栏脱钩。

## Verification

- `web/tests/model-catalog-editor.test.tsx`：按 kind 分组、筛选与新建连接 `supplier_id: null`。
- `npm run verify-notes`。
