---
name: galgame-project-assets
description: Manages Galgame project assets—upload, batch upload, overview/manifest, repair missing refs, and voice-to-dialogue matching. Use when importing or fixing media/voice assets in a Galgame project.
---

# galgame-project-assets

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 多部分上传用 `--file`（字段名见 `fpl operations`）；禁止静默重试。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

向 Galgame 项目导入或修复媒体/语音素材。

## 不在范围

剧本文本 → `galgame-story-editing`。转录 → `galgame-transcription-asr`。

## 方法

- `list_project_assets` / `upload_project_asset` / `batch_upload_project_assets`
- `get_project_asset_overview` / `get_project_package_manifest` / `scan_project_asset_metadata`
- `preview_project_asset_import` / `patch_project_asset` / `delete_project_asset`
- `repair_project_asset` / `match_voice_to_dialogue`

## 工作流

1. 上传：`upload_project_asset` / `batch_upload_project_assets` + `--file`。
2. 批次后刷新 overview/manifest。
3. 导出/预览前 `repair_project_asset`。
4. 语音匹配须在素材与对白 id 就绪后进行。

## 最小可运行示例

```bash
fpl call galgame.list_project_assets --input '{"project_id":"<id>"}'
fpl operations galgame.upload_project_asset
# 示例（字段名以 operations 为准）：
# fpl call galgame.upload_project_asset --input '{"project_id":"<id>","body":{...}}' --file upload=./voice.wav
fpl call galgame.get_project_asset_overview --input '{"project_id":"<id>"}'
```

## 失败处理

- 上传字段错误 → 先 `fpl operations`。
- 缺失引用 → `repair_project_asset`，不要盲目重复上传同一文件循环。

## 相关 skill

`galgame-story-editing`、`galgame-transcription-asr`、`files-library`。
