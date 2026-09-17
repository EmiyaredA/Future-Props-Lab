---
name: video-timeline-editing
description: Edits Video Editor timelines via video.get_timeline and apply_timeline_operations (clips, tracks, revision batches). Use when adding/updating/removing clips or timeline structure in Future Props Lab video workshop.
---

# video-timeline-editing

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 批次常用 `expectedRevision` + `requestId`（字段名以 `fpl operations` 为准）；409 重新 get，禁止静默重试。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

在视频剪辑工坊增删改片段或时间轴结构。

## 不在范围

上传/代理 → `video-media-assets`。成片/分段导出 → `video-render-export`。

## 方法

- `video.get_timeline`
- `video.apply_timeline_operations`

## 工作流

1. 无项目时：`video.create_project`。
2. `get_timeline` → revision 与轨道 id。
3. `apply_timeline_operations`。
4. 再 get；`fpl open video <project_id>`。

## 最小可运行示例

```bash
echo '{"body":{"title":"新时间轴"}}' | fpl call video.create_project --input -
fpl call video.get_timeline --input '{"project_id":"<id>"}'

echo '{
  "project_id":"<id>",
  "body":{
    "expectedRevision":N,
    "requestId":"req-1",
    "operations":[
      {
        "type":"addClip",
        "clip":{
          "id":"black",
          "trackId":"visual-1",
          "kind":"color",
          "name":"黑场",
          "timelineStartUs":0,
          "sourceInUs":0,
          "durationUs":2000000,
          "color":"#000000"
        }
      }
    ]
  }
}' | fpl call video.apply_timeline_operations --input -
```

轨道 id 以 get_timeline 实际返回为准。

## 失败处理

- 409 → 重新 get_timeline，换新 `requestId`。
- 轨道不存在 → 先读 timeline 再组 operations。

## 相关 skill

`workshop-project-library`、`video-media-assets`、`video-render-export`。
