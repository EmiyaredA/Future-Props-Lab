---
name: audio-annotation-project-and-document
description: Creates and edits Audio Annotation projects and documents via annotation.* CRUD and apply_annotation_operations; usually after files.upload_file. Use when building the core annotation loop (speakers/segments) in Future Props Lab.
---

# audio-annotation-project-and-document

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 上传音频用 `--file upload=PATH`；文档写入带 revision + `request_id`；409 重新 get，禁止静默重试。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`；上传用 `files-library`。

## 何时使用

录音标注项目库 + 说话人/段落文档编辑（核心标注闭环）。

## 不在范围

波形与段落转录 → `audio-annotation-segment-transcription`。

## 方法

- 项目：`list_projects`、`create_project`、`get_project`、`patch_project`、`delete_project`、`import_project`
- 文档：`get_document`、`put_document`、`apply_annotation_operations`
- 导出：`export_annotation`（`json` | `srt`）

## 工作流

1. `files.upload_file`，`--file upload=PATH`。
2. `annotation.create_project`，带 `asset_id`。
3. `get_document` → revision / 段落 id。
4. `apply_annotation_operations`。
5. `export_annotation` + `--output`；`fpl open annotation <project_id>`。

## 最小可运行示例

```bash
fpl call files.upload_file --input '{"body":{}}' --file upload=./recording.wav
echo '{"body":{"title":"标注","asset_id":"<asset_id>"}}' | fpl call annotation.create_project --input -
fpl call annotation.get_document --input '{"project_id":"<id>"}'

echo '{
  "project_id":"<id>",
  "body":{
    "expected_revision":N,
    "request_id":"req-1",
    "operations":[
      {"entity":"speaker","action":"insert","id":"speaker-1","value":{"name":"讲述者","color":"#405c80"}}
    ]
  }
}' | fpl call annotation.apply_annotation_operations --input -

fpl call annotation.export_annotation \
  --input '{"project_id":"<id>","expected_revision":N,"format":"srt"}' \
  --output ./out.srt
```

## 失败处理

- 缺 asset_id → 先上传。
- 409 → 重新 get_document。

## 相关 skill

`files-library`、`audio-annotation-segment-transcription`、`workshop-project-library`。
