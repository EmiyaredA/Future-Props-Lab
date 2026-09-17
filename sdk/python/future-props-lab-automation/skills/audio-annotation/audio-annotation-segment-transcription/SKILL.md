---
name: audio-annotation-segment-transcription
description: Uses Audio Annotation waveform and segment transcription—get/put waveform, transcribe segments, download segment audio, import transcription JSON/tasks. Use when ASR-assisting annotation segments or importing existing transcripts.
---

# audio-annotation-segment-transcription

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"`（模型调用常需 `--write`）→ `fpl status`。
2. 已有标注项目与段落；需要上传时用 `--file`；模型提交禁止静默重试。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

对标注段落做 ASR/转录辅助，或导入已有转录包。

## 不在范围

不含转录的通用项目 CRUD → `audio-annotation-project-and-document`。

## 方法

- `get_waveform` / `put_waveform`
- `transcribe_segment` / `transcribe_saved_segment`
- `download_segment_audio`
- `import_transcription`

## 工作流

1. 确保文档段落已存在。
2. 按需 get/put 波形。
3. 转录方法按 `fpl operations` 传参；需上传音频时用 `--file`。
4. 外部 JSON/任务用 `import_transcription`。
5. 校对后的文本用 `apply_annotation_operations` 落盘。

## 最小可运行示例

```bash
fpl call annotation.get_waveform --input '{"project_id":"<id>"}'
fpl operations annotation.transcribe_segment
fpl call annotation.download_segment_audio \
  --input '{"project_id":"<id>","segment_id":"<seg>"}' \
  --output ./seg.wav
```

（`segment_id` 等字段名以 operations 为准。）

## 失败处理

- 转录失败 → 报告；禁止自动重复提交同一段落。
- 落盘校对 → 走 `apply_annotation_operations`，不要假设转录已写入文档。

## 相关 skill

`audio-annotation-project-and-document`、`fpl-contracts`。
