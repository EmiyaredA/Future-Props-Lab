---
name: thought-note-editing
description: Edits Thought Workshop notes via get_note, put_note, apply_note_operations, history restore, md/html export, and image/attachment upload. Use when changing note body, exporting, or restoring history.
---

# thought-note-editing

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 写入带 `expected_revision`（删除还可能要 `expected_knowledge_revision`）；下载用 `--output`；禁止静默重试。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

在思绪工坊内改笔记正文、导出或恢复历史。

## 不在范围

知识库树 → `thought-knowledge-library`。流式 AI 写作 → `thought-writing-assistant`。

## 方法

- `get_note` / `put_note` / `apply_note_operations`
- `export_note_content`（`format`：`md` | `html`）
- `note_history` / `note_history_detail` / `restore_note_history` / `restore_note`
- `upload_image` / `attachments` / `imports` / `convert_markdown`
- `delete_note`

## 工作流

1. `get_note` → revision + 文档。
2. 优先 `apply_note_operations`，避免盲目整篇 `put_note`。
3. 导出时带 `expected_revision` + `--output`。
4. `fpl open note <note_id>` 查看。

## 最小可运行示例

```bash
fpl call thought.get_note --input '{"note_id":"<id>"}'

echo '{
  "note_id":"<id>",
  "body":{
    "expected_revision":N,
    "request_id":"req-1",
    "operations":[
      {"action":"replace_text","path":[0,0],"start":0,"end":4,"text":"更新后的内容"}
    ]
  }
}' | fpl call thought.apply_note_operations --input -

fpl call thought.export_note_content \
  --input '{"note_id":"<id>","expected_revision":N,"format":"md"}' \
  --output ./note.md
```

字段以 `fpl operations thought.apply_note_operations` 为准。

## 失败处理

- 409 → 重新 get，换新 `request_id`。
- 导出失败 → 刷新 revision；不要静默循环导出。

## 相关 skill

`thought-knowledge-library`、`thought-writing-assistant`。
