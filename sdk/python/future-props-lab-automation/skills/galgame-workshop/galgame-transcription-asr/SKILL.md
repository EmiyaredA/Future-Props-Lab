---
name: galgame-transcription-asr
description: Configures Galgame ASR and creates/queries transcription tasks; patches asset transcripts via galgame.* APIs. Use when running speech recognition or fixing transcripts on Galgame project audio.
---

# galgame-transcription-asr

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"`（模型调用常需 `--write`）→ `fpl status`。
2. 项目素材已就绪；任务只创建一次；wait 仅用于 GET 查询；禁止静默重提交。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

对 Galgame 项目音频做语音识别/转录。

## 不在范围

剧本编辑；视频导出/交接。

## 方法

- `get_asr_settings` / `patch_asr_settings`
- `list_transcriptions` / `create_transcriptions`
- `patch_asset_transcript`
- 相关导入：`preview_annotation_import` / `create_annotation_import` / `get_annotation_import`

## 工作流

1. `get_asr_settings` / 按需 `patch_asr_settings`。
2. `create_transcriptions`（body 见 schema）。
3. 列表/查询轮询；仅 GET + status 时用 `fpl wait`。
4. 需要时 `patch_asset_transcript` 人工校对。

## 最小可运行示例

```bash
fpl call galgame.get_asr_settings --input '{"project_id":"<id>"}'
fpl operations galgame.create_transcriptions
fpl call galgame.list_transcriptions --input '{"project_id":"<id>"}'
```

## 失败处理

- 创建失败 → 报告错误；禁止自动再次 `create_transcriptions`。
- wait 超时 → 只停等待，不取消/不重提（除非用户明确要求 cancel）。

## 相关 skill

`galgame-project-assets`、`galgame-story-editing`。
