---
name: model-inference
description: Runs standalone model inference tasks via inference.* (not playground)—assets, create/list tasks, text/stream, download, save_result, and disk-only retry_materialization. Use when running independent model jobs outside workshop generation drawers or playground.
---

# model-inference

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"`（模型调用常需 `--write`）→ `fpl status`。
2. **只创建一次** `create_task`；`retry_materialization` 只重试落盘；禁止重新提交供应商；流必须关闭。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

工坊生成抽屉 / 模型测试 playground **之外**的独立模型任务。

## 不在范围

`testing` playground；`models` 目录/供应商管理；视觉 `generation.*` 工坊任务。

## 方法

- 素材：`upload_asset`、`import_asset`、`delete_asset`
- 任务：`model_options`、`list_tasks`、`create_task`、`get_task`、`delete_task`
- 结果：`download_result`、`save_result`、`retry_materialization`
- 文本：`generate_text`、`stream_text`

## 工作流

1. `model_options` → 选择模型/能力。
2. 需要时上传/导入输入。
3. `create_task`；有 status 时用 `fpl wait` 轮询 `get_task`。
4. 下载/转存；仅落盘失败时 `retry_materialization`（带 revision）。
5. `stream_text` 在 Python SDK 中正确关闭流。

## 最小可运行示例

```bash
fpl call inference.model_options --input '{}'
fpl operations inference.create_task
fpl call inference.list_tasks --input '{}'
fpl wait inference.get_task --input '{"task_id":"<id>"}' --timeout 300 --interval 2
fpl call inference.download_result --input '{"task_id":"<id>"}' --output ./result.bin
```

## 失败处理

- 任务失败 → 报告；禁止静默再次 `create_task`。
- wait 超时 → 只停等待。

## 相关 skill

`files-library`、`call-logs-readonly`、`fpl-contracts`。
