---
name: visual-generation-tasks
description: Drives Visual Workshop generation tasks via generation.*—options, create/list tasks and batches, compositions, wait polling, and retry_materialization for disk only. Use when creating or monitoring image/video/audio generation for a visual project.
---

# visual-generation-tasks

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"`（模型调用常需 `--write`）→ `fpl status`。
2. 已有 `project_id`；**只创建一次**任务；`submitting` 中断必须保持失败，禁止自动重提交。
3. `retry_materialization` 只重试落盘，绝不重新提交供应商。
4. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

为视觉项目创建或监视图/视/音频生成。

## 不在范围

画布编辑由 `visual-canvas-editing` 负责。

## 方法

- `generation.generation_options`
- `generation.create_generation_task` / `create_generation_batch` / `create_image_composition`
- `generation.get_generation_task` / `list_generation_tasks`
- `generation.get_generation_batch` / `list_generation_batches`
- `generation.retry_materialization` / `retry_image_composition`

## 工作流

1. `generation_options` → 选择允许的模型/类型。
2. 创建任务/批次（schema 见 `fpl operations`）。
3. `fpl wait generation.get_generation_task --input '{"task_id":"..."}'`。
4. 供应商已完成但落盘失败时，有意调用一次 `retry_materialization`。

## 最小可运行示例

```bash
fpl call generation.generation_options --input '{}'
fpl operations generation.create_generation_task
# 按 schema 创建后轮询：
fpl wait generation.get_generation_task --input '{"task_id":"<task_id>"}' --timeout 300 --interval 2
```

## 失败处理

- wait 超时 → 只停止等待；需要取消时用 capabilities 中的 cancel（若有）。
- 失败任务 → 报告错误；禁止静默 `create_*` 重提。

## 相关 skill

`visual-canvas-editing`、`workshop-project-library`、`fpl-contracts`。
