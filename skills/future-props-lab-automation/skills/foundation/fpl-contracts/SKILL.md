---
name: fpl-contracts
description: Stable fpl call/wait contracts for Future Props Lab—resource.method discovery, JSON kwargs, files, revision CAS, no silent retries, downloads. Use when calling fpl after pairing or before any write.
---

# fpl-contracts

## 前置（单独安装时必做）

1. App 已运行且已配对：`fpl connect --name "<代理名>"` → `fpl status`。
2. 调用前先：`fpl operations` 或 `fpl operations <resource.method>`。
3. 更全配对说明可另装 `fpl-connect`。

## 何时使用

配对之后的任何 `fpl call` / `fpl wait` / Python SDK 写入。各工坊 skill 默认遵守本约定。

## 不在范围

配对与 UI open → `fpl-connect`。各应用具体 payload → 对应业务 skill。

## 发现方法

```bash
fpl operations
fpl operations visual.create_project
```

优先用已列出的方法，不要猜 OpenAPI 路径。

## 调用形状

`fpl call` 传入的是 **SDK 关键字参数** JSON（不是单独的裸 HTTP body）：

```bash
echo '{"body":{"title":"示例","kind":"canvas"}}' | fpl call visual.create_project --input -
```

- `--input -` 读标准输入，否则为文件路径。
- 文件只能用 `--file FIELD=PATH`（禁止在 JSON 的 `files` 里塞字节）。
- 下载：加 `--output /路径`（覆盖时加 `--overwrite`）。

Python 侧在 `Client` / `AsyncClient` 上使用同名方法。

## wait

```bash
fpl wait video.get_render --input '{"project_id":"...","task_id":"..."}' --timeout 300 --interval 2
```

- 只允许 **GET** 类任务查询。
- 在 `completed` / `failed` / `cancelled` 时结束。
- 超时只停止**等待**，不会取消服务端任务，也不会重新提交。

## revision / CAS

- 先读当前快照；写入时带上该方法要求的 `expected_revision`（或等价字段）。
- 缺少 revision → 视为客户端错误（422 类）。
- 冲突 → **409** 与当前快照；重新读取、有意合并后，用新 revision **再试一次**。禁止对同一 payload 盲目重试。
- 批次编辑：调用方生成 `request_id` + `operations`；一批只更新一个资源；任一步失败则整批不保存。

## 硬性规则

1. 写入与模型提交 **禁止静默重试**。
2. 提供 `retry_materialization` 的地方，只重试**结果落盘**，绝不重新提交供应商生成。
3. 下载 / 事件流必须关闭（CLI 的 `--output` 会处理文件；Python 使用上下文管理器）。
4. CLI 返回错误 JSON 时如实上报，不要当成成功。

## 最小可运行示例

```bash
echo '{"body":{"title":"画布","kind":"canvas"}}' | fpl call visual.create_project --input -
fpl operations visual.apply_canvas_operations
```

## 失败处理

- 422 缺 revision → 先 get 再带 `expected_revision` 写入。
- 409 → 丢弃旧 payload，重新 get 后重建 operations。
- wait 超时 → 报告超时；需要取消时显式调用 cancel 方法。

## 相关 skill

`fpl-connect`；各业务叶子 skill。
