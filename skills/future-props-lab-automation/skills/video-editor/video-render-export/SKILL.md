---
name: video-render-export
description: Creates and monitors Video Editor renders and segment exports—preflight, wait, cancel, download, and project snapshots. Use when producing final/range exports or backing up a video project.
---

# video-render-export

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 创建任务只一次；wait 超时 ≠ 取消；取消须显式 cancel；失败渲染禁止静默重提。
3. 下载用 `--output`。更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

从时间轴产出成片/区间导出，或用快照备份。

## 不在范围

搭建时间轴 → `video-timeline-editing`。

## 方法

- 渲染：`render_preflight`、`create_render`、`list_renders`、`get_render`、`cancel_render`、`delete_render`
- 分段：`create_segment_export`、`list_segment_exports`、`get_segment_export`、`cancel_segment_export`、`download_segment_export`
- 快照：`export_project_snapshot` / `import_project_snapshot`
- 辅助：`exact_frame`、`text_clip_layer`（按需）

## 工作流

1. 可选 `render_preflight`。
2. `create_render` / `create_segment_export`。
3. `fpl wait video.get_render` 或 `video.get_segment_export`。
4. 分段结果用 `--output` 下载。

## 最小可运行示例

```bash
fpl call video.export_project_snapshot --input '{"project_id":"<id>"}' --output ./video.snapshot.zip
fpl operations video.create_render
fpl wait video.get_render --input '{"project_id":"<id>","task_id":"<task_id>"}' --timeout 600 --interval 2
```

`task_id` 字段名以 `fpl operations video.get_render` 为准。

## 失败处理

- wait 超时 → 报告；需要取消时 `cancel_render` / `cancel_segment_export`。
- 失败 → 禁止静默再次 `create_render`。

## 相关 skill

`video-timeline-editing`、`video-media-assets`。
