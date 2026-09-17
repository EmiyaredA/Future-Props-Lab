---
name: presentation-slides-editing
description: Edits Future Props Lab presentation projects via get_project, put_project, and apply_presentation_operations with revision and request_id. Use when changing slides, speaker notes, or layout in presentation workshop.
---

# presentation-slides-editing

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. call 用 SDK 关键字 JSON；写入带 `expected_revision` + 唯一 `request_id`；409 重新 get 再合并，禁止静默重试。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

在已有演示工坊项目中修改幻灯片、讲稿或版式相关内容。

## 不在范围

PPTX 下载 → `presentation-pptx-export`。项目创建/删除 → `workshop-project-library`。

## 方法

- `presentation.get_project`
- `presentation.put_project`（需要整体替换文档时）
- `presentation.apply_presentation_operations`（优先增量编辑）

## 工作流

1. 无项目时先创建：`presentation.create_project`（可带初始 `document`）。
2. `get_project` → `revision` 与 slide id。
3. `apply_presentation_operations`：`expected_revision`、`request_id`、`operations`。
4. 遇 409：重新 get，重建 operations；不要用同一 `request_id` 提交不同内容。
5. 再 get 核对；可选 `fpl open presentation <project_id>`。

## 最小可运行示例

```bash
# 创建（可选）
echo '{"body":{"title":"演示","document":{"version":1,"width":1280,"height":720,"slides":[{"id":"slide-1","background":"#ffffff","notes":"","elements":[]}]}}}' \
  | fpl call presentation.create_project --input -

fpl call presentation.get_project --input '{"project_id":"<id>"}'

# 将 N 换成当前 revision；slide id 来自 get 结果
echo '{
  "project_id":"<id>",
  "body":{
    "expected_revision":N,
    "request_id":"req-1",
    "operations":[
      {"entity":"slide","action":"update","id":"<slide_id>","value":{"notes":"讲稿已更新"}}
    ]
  }
}' | fpl call presentation.apply_presentation_operations --input -
```

复杂字段以 `fpl operations presentation.apply_presentation_operations` 为准。

## 失败处理

- 409 → 丢弃旧批次，重新 get 后换新 `request_id`。
- 422 缺 revision → 先 get。

## 相关 skill

`workshop-project-library`、`presentation-pptx-export`、`fpl-contracts`。
