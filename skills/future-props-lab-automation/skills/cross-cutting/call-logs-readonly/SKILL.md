---
name: call-logs-readonly
description: Read-only Future Props Lab LLM call logs via logs.list_logs, detail, stats, and reproduction_bundle. Use when investigating past model calls or downloading a repro bundle. Desktop Agent cannot delete logs.
---

# call-logs-readonly

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 下载复现包用 `--output`。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

排查历史模型调用；下载复现包。

## 不在范围

改模型目录；自动重放写入。桌面禁止删除日志。

## 方法（桌面）

- `logs.list_logs` / `logs.detail` / `logs.stats`
- `logs.reproduction_bundle`（`--output`）

## 桌面禁止

`logs.delete_one` / `logs.batch_delete` 不在白名单。不要用 `fpl` 臆造删除。

## 工作流

1. `list_logs` 定位条目。
2. `detail` 看单条。
3. 需要时 `reproduction_bundle` + `--output`。

## 最小可运行示例

```bash
fpl call logs.list_logs --input '{"page":1,"page_size":20}'
fpl call logs.detail --input '{"log_id":"<id>"}'
fpl call logs.reproduction_bundle --input '{"log_id":"<id>"}' --output ./repro.zip
```

## 失败处理

- 删除类方法报错/不在 capabilities → 停止，改走 App UI 或具备权限的 HTTP API（若产品允许），不要用 `fpl` 硬闯。

## 相关 skill

`model-inference`、`visual-generation-tasks`。
