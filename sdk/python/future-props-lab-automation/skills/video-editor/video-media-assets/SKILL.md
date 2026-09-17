---
name: video-media-assets
description: Manages Video Editor media—list/upload/import assets, retry proxy, get variants. Use when bringing disk or files-library media into a video project.
---

# video-media-assets

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 上传用 `--file`；`retry_proxy` 仅代理失败时有意调用，禁止盲目循环。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`；常用 `files-library`。

## 何时使用

从磁盘或文件库把媒体纳入视频项目。

## 不在范围

时间轴操作 → `video-timeline-editing`。成片渲染 → `video-render-export`。

## 方法

- `list_assets` / `upload_asset` / `import_assets` / `import_sources`
- `delete_asset` / `retry_proxy` / `asset_variant`

## 工作流

1. 文件库已有素材时优先 `import_assets`。
2. 直接上传用 CLI `--file`。
3. 仅在代理生成失败时 `retry_proxy`。
4. 在时间轴 operations 中使用素材 id。

## 最小可运行示例

```bash
fpl call video.list_assets --input '{"project_id":"<id>"}'
fpl operations video.upload_asset
fpl operations video.import_assets
# 示例：
# fpl call video.upload_asset --input '{"project_id":"<id>","body":{}}' --file upload=./clip.mp4
```

## 失败处理

- 上传字段错误 → `fpl operations`。
- 代理失败 → 有意一次 `retry_proxy`；仍失败则报告，不要循环。

## 相关 skill

`files-library`、`video-timeline-editing`。
