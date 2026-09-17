---
name: galgame-story-editing
description: Edits Galgame Workshop stories via get_story, put_story, apply_story_operations, and dialogue/edit patches. Use when changing chapters, fragments, dialogue blocks, or story document structure.
---

# galgame-story-editing

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 写入带 `expected_revision` + `request_id`（批次）；409 重新 get，禁止静默重试。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

修改 Galgame 工坊的章节、片段、对白块或剧本文档结构。

## 不在范围

素材/ASR/导出交接 → 其他 `galgame-*` skill。

## 方法

- `galgame.get_story` / `put_story` / `apply_story_operations`
- `galgame.patch_story_dialogue` / `patch_story_edits`
- 迁移（仅明确需要时）：`run_story_migrations` / `get_story_migration_status`

## 工作流

1. 创建/打开项目。
2. 初始结构：`put_story`（`expected_revision` + `document`）。
3. 细粒度：`apply_story_operations`。
4. `get_story` 核对；`fpl open galgame <project_id>`。

## 最小可运行示例

```bash
echo '{"body":{"title":"新剧情"}}' | fpl call galgame.create_project --input -

echo '{
  "project_id":"<id>",
  "body":{
    "expected_revision":0,
    "document":{
      "schemaVersion":"1.4",
      "entryChapterId":"chapter-1",
      "characters":[{"id":"narrator","name":"讲述者"}],
      "scenes":[],
      "variables":[],
      "assets":[],
      "chapters":[{
        "id":"chapter-1",
        "title":"开始",
        "order":1,
        "entryFragmentId":"main",
        "fragments":[{
          "id":"main",
          "title":"开场",
          "blocks":[{
            "id":"line-1",
            "type":"dialogue",
            "characterId":"narrator",
            "text":"初始对白"
          }]
        }]
      }]
    }
  }
}' | fpl call galgame.put_story --input -

fpl call galgame.get_story --input '{"project_id":"<id>"}'
```

## 失败处理

- 409 → 重新 get_story，重建 put/operations。
- schema 校验失败 → 按错误修正 document，不要盲目重试同一 payload。

## 相关 skill

`workshop-project-library`、`galgame-project-assets`、`galgame-transcription-asr`、`galgame-export-handoff`。
