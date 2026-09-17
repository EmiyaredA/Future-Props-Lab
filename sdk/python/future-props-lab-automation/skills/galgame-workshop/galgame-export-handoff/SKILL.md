---
name: galgame-export-handoff
description: Exports Galgame snapshots, runs video export tasks, and creates handoffs into Video Editor. Use when backing up a Galgame project, exporting video, or transferring work to the video workshop.
---

# galgame-export-handoff

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 下载用 `--output`；wait 只停等待；取消/重试须显式发起，禁止静默循环。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

快照备份、Galgame 视频导出，或把工程交接给视频剪辑工坊。

## 不在范围

视频工坊时间轴编辑 → `video-timeline-editing`。

## 方法

- `export_project_snapshot` / `import_project_snapshot`
- 视频导出：`list_video_exports`、`create_video_export`、`preview_video_export`、`get_video_export`、`cancel_video_export`、`download_video_export`
- 交接：`list_handoffs`、`create_handoff`、`get_handoff`、`cancel_handoff`

## 工作流

1. 快照：`export_project_snapshot` + `--output`。
2. 视频导出：创建 →（若为 GET）`fpl wait galgame.get_video_export` → 下载。
3. 交接：`create_handoff` 后轮询 `get_handoff`；新项目 id 用 `fpl open video <id>`。

## 最小可运行示例

```bash
fpl call galgame.export_project_snapshot --input '{"project_id":"<id>"}' --output ./galgame.snapshot.zip
fpl operations galgame.create_video_export
fpl operations galgame.create_handoff
```

## 失败处理

- wait 超时 ≠ 取消；取消须 `cancel_video_export` / `cancel_handoff`。
- 导出失败 → 报告；禁止静默重提 create。

## 相关 skill

`galgame-story-editing`、`video-timeline-editing`。
