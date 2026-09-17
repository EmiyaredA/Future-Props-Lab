---
name: visual-canvas-editing
description: Edits Visual Workshop canvases via get_canvas, put_canvas, and apply_canvas_operations. Use when inserting/updating/deleting canvas nodes or replacing canvas documents in Future Props Lab.
---

# visual-canvas-editing

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. call 用 SDK 关键字 JSON；批次带 `expected_revision` + `request_id`；409 重新 get，禁止静默重试。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

在视觉创作工坊中增删改画布节点，或替换画布文档。

## 不在范围

素材引用 → `visual-project-assets`。生成任务 → `visual-generation-tasks`。`visual_assistant` 不在桌面 Agent 白名单。

## 方法

- `visual.get_canvas` / `put_canvas` / `apply_canvas_operations`
- 可选 `export_project_snapshot`

## 工作流

1. 无项目时：`visual.create_project`，`kind: canvas`。
2. `get_canvas` → `revision`。
3. `apply_canvas_operations`。
4. 再 get 核对；可选快照 / `fpl open visual <project_id>`。

## 最小可运行示例

```bash
echo '{"body":{"title":"画布","kind":"canvas"}}' | fpl call visual.create_project --input -
fpl call visual.get_canvas --input '{"project_id":"<id>"}'

echo '{
  "project_id":"<id>",
  "body":{
    "expected_revision":N,
    "request_id":"req-1",
    "operations":[
      {
        "entity":"node",
        "action":"insert",
        "id":"instruction",
        "value":{
          "id":"instruction",
          "kind":"text",
          "title":"文本",
          "text":"自动化创建的创作说明",
          "position":{"x":0,"y":0}
        }
      }
    ]
  }
}' | fpl call visual.apply_canvas_operations --input -
```

## 失败处理

- 409 → 重新 get，换新 `request_id`。
- 节点 schema 不符 → `fpl operations visual.apply_canvas_operations`。

## 相关 skill

`workshop-project-library`、`visual-project-assets`、`visual-generation-tasks`。
