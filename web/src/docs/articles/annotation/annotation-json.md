<!-- docs: {"group":"annotation","order":29,"title":"导出项目 JSON","lead":"","evidence":["web/src/features/audio-annotation"]} -->

# 导出项目 JSON

<!-- prerequisites -->

面向录音标注工坊用户。先准备有权使用的录音和当前空间的标注项目；修改需要写权限。保存、项目 JSON 与 SRT 的要求不同，按下文分别检查。

## 保存可继续编辑的标注

点击编辑器“导出标注”，选择“项目 JSON”。即使仍有片段缺少说话人或文字，也可以导出以保留草稿。

![项目 JSON 与 SRT 导出选择](/docs/annotation-export.jpg "真实界面 · 隔离演示数据；合成素材或本机确定性响应，不代表外部模型效果。")

## 文件结构

项目导出使用 kind、schema_version、exported_at、project、speakers 和 segments。时间以毫秒记录，源文件元信息不等于把录音二进制嵌入 JSON。

以下内容来自隔离演示项目实际下载的项目 JSON，保留完整字段。示例音频为合成测试音，不是人物录音：

```json
{
  "kind": "future-props-audio-annotation",
  "schema_version": "1.0",
  "exported_at": "2026-09-08T07:33:41.983Z",
  "project": {
    "title": "文档演示 · 双人访谈",
    "duration_ms": 8000,
    "source": {
      "asset_id": "25ff1ede-b683-4d42-8edb-7df0afffc91b",
      "display_name": "interview",
      "original_filename": "interview.wav",
      "mime_type": "audio/wav",
      "byte_size": 256078
    }
  },
  "speakers": [
    {
      "id": "host",
      "name": "主持人",
      "color": "#ed805b"
    },
    {
      "id": "guest",
      "name": "来宾",
      "color": "#83bfa6"
    }
  ],
  "segments": [
    {
      "id": "seg-1",
      "start_ms": 0,
      "end_ms": 3000,
      "speaker_id": "host",
      "speaker_ids": ["host"],
      "emotion": null,
      "text": "欢迎来到我们的第一段访谈。",
      "language": null,
      "localized_texts": [],
      "status": "reviewed"
    },
    {
      "id": "seg-2",
      "start_ms": 3200,
      "end_ms": 7200,
      "speaker_id": "guest",
      "speaker_ids": ["guest"],
      "emotion": null,
      "text": "这是一份用于文档截图的演示标注。",
      "language": null,
      "localized_texts": [],
      "status": "reviewed"
    }
  ]
}
```

## 重新导入

保存对应录音，再从项目列表“导入项目”恢复。上面的示例 ID 仅用于说明结构，导入时应选择自己的实际音频。
