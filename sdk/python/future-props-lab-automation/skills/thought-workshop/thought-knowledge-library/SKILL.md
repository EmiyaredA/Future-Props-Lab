---
name: thought-knowledge-library
description: Manages Thought Workshop knowledge bases and directory trees via thought.*. Use when creating/listing/trashing knowledge bases, browsing directory, moving entries, or creating notes—the Thought Workshop home surface.
---

# thought-knowledge-library

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. call 用 SDK 关键字 JSON；建笔记时常需 `expected_knowledge_revision`；409 重新读取再写。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

思绪工坊主页：知识库网格与库内文档树（不是富文本正文编辑）。

## 不在范围

笔记正文/导出/历史 → `thought-note-editing`。AI 写作流 → `thought-writing-assistant`。

## 方法

- 知识库：`knowledge_bases`、`create_knowledge_base`、`knowledge_base`、`update_knowledge_base`、`trash_knowledge_base`、`restore_knowledge_base`
- 树：`directory`、`move_entry`、`create_document` / `create_note`
- UI：`fpl open knowledge <knowledge_base_id>` 或 `fpl open note <note_id>`

## 工作流

1. `thought.knowledge_bases`（`trash` 查看回收站）。
2. `create_knowledge_base`，`body.title`。
3. `directory`，`project_id` = 知识库 id。
4. 在库下建笔记，带上知识库的 `expected_knowledge_revision`。
5. `move_entry` 整理（revision 以 schema 为准）。
6. 软删 / 恢复：`trash_knowledge_base` / `restore_knowledge_base`。

## 最小可运行示例

```bash
echo '{"body":{"title":"文档库"}}' | fpl call thought.create_knowledge_base --input -
fpl open knowledge <knowledge_base_id>

# 建笔记（N = 知识库 revision；document 为简易 doc）
echo '{
  "body":{
    "title":"自动化笔记",
    "knowledge_base_id":"<kb_id>",
    "expected_knowledge_revision":N,
    "document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"初始内容"}]}]}
  }
}' | fpl call thought.create_note --input -
```

## 失败处理

- 缺 `expected_knowledge_revision` → 先 `knowledge_base` / `directory` 取 revision。
- 409 → 重新 get 知识库 revision。

## 相关 skill

`thought-note-editing`、`thought-writing-assistant`、`fpl-contracts`。
