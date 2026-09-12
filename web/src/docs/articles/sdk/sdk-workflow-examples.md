<!-- docs: {"group": "sdk-workshops", "category": "sdk", "order": 5, "title": "六个工坊的完整样例", "lead": "从创建、细粒度编辑到读取和导出。", "evidence": ["sdk/python/src/future_props_lab/workshop_examples.py", "tests/test_sdk_workflows.py"], "prerequisites": "Python 3.11+；工作区密钥有 content.write；已创建输出目录。录音示例需要 WAV 输入。", "related": ["sdk-editing", "sdk-files", "sdk-errors"]} -->

# 六个工坊的完整样例

这些函数随 SDK 安装，由 tests/test_sdk_workflows.py 在隔离服务端执行。传入 AsyncClient 和明确的输出路径，返回资源 ID 与最新保存内容。

视觉、Galgame 与剪辑导出可重新导入的项目包；思绪导出 Markdown，演示导出 PPTX，录音标注导出 SRT。视频成片另用 create_render 与下载结果接口。

测试同时使用网页所消费的正式读取接口验证修改可见；这里的六条流程验证不代表每一种编辑组合均已覆盖。

## 共用导入

```python
from uuid import uuid4
from future_props_lab.builders import edit_batch, entity_edit, note_document, presentation_document, text_node
```

## 视觉工坊

```python
async def visual_workflow(client, output):
    project = await client.visual.create_project(body={"title": "Python 画布", "kind": "canvas"})
    canvas = await client.visual.get_canvas(project_id=project.id)
    node = text_node("自动化创建的创作说明", id="instruction")
    await client.visual.apply_canvas_operations(
        project_id=project.id,
        body=edit_batch(canvas.revision, entity_edit("node", "insert", node["id"], value=node)),
    )
    saved = await client.visual.get_canvas(project_id=project.id)
    async with await client.visual.export_project_snapshot(project_id=project.id) as download:
        await download.save(output)
    return project.id, saved
```

## Galgame 工坊

```python
async def galgame_workflow(client, output):
    project = await client.galgame.create_project(body={"title": "Python 剧情"})
    document = {
        "schemaVersion": "1.4",
        "entryChapterId": "chapter-1",
        "characters": [{"id": "narrator", "name": "讲述者"}],
        "scenes": [],
        "variables": [],
        "assets": [],
        "chapters": [
            {
                "id": "chapter-1",
                "title": "开始",
                "order": 1,
                "entryFragmentId": "main",
                "fragments": [
                    {
                        "id": "main",
                        "title": "开场",
                        "blocks": [
                            {
                                "id": "line-1",
                                "type": "dialogue",
                                "characterId": "narrator",
                                "text": "初始对白",
                            }
                        ],
                    }
                ],
            }
        ],
    }
    story = await client.galgame.put_story(
        project_id=project.id,
        body={"expected_revision": 0, "document": document},
    )
    await client.galgame.apply_story_operations(
        project_id=project.id,
        body=edit_batch(
            story.revision,
            entity_edit(
                "block",
                "update",
                "line-1",
                parent_id="main",
                value={"text": "细粒度更新后的对白"},
            ),
        ),
    )
    saved = await client.galgame.get_story(project_id=project.id)
    async with await client.galgame.export_project_snapshot(project_id=project.id) as download:
        await download.save(output)
    return project.id, saved
```

## 视频剪辑

```python
async def video_workflow(client, output):
    project = await client.video.create_project(body={"title": "Python 时间轴"})
    timeline = await client.video.get_timeline(project_id=project.id)
    await client.video.apply_timeline_operations(
        project_id=project.id,
        body={
            "expectedRevision": timeline.revision,
            "requestId": str(uuid4()),
            "operations": [
                {
                    "type": "addClip",
                    "clip": {
                        "id": "black",
                        "trackId": "visual-1",
                        "kind": "color",
                        "name": "黑场",
                        "timelineStartUs": 0,
                        "sourceInUs": 0,
                        "durationUs": 2_000_000,
                        "color": "#000000",
                    },
                }
            ],
        },
    )
    saved = await client.video.get_timeline(project_id=project.id)
    async with await client.video.export_project_snapshot(project_id=project.id) as download:
        await download.save(output)
    return project.id, saved
```

## 思绪工坊

```python
async def thought_workflow(client, output):
    folder = await client.thought.create_knowledge_base(body={"title": "Python 文档"})
    note = await client.thought.create_note(
        body={
            "title": "自动化笔记",
            "knowledge_base_id": folder.id,
            "expected_knowledge_revision": folder.revision,
            "document": note_document("初始内容"),
        }
    )
    await client.thought.apply_note_operations(
        note_id=note.id,
        body=edit_batch(
            note.revision,
            {
                "action": "replace_text",
                "path": [0, 0],
                "start": 0,
                "end": 4,
                "text": "更新后的内容",
            },
        ),
    )
    saved = await client.thought.get_note(note_id=note.id)
    async with await client.thought.export_note_content(
        note_id=note.id,
        expected_revision=saved.revision,
        format="md",
    ) as download:
        await download.save(output)
    return note.id, saved
```

## 演示工坊

```python
async def presentation_workflow(client, output):
    project = await client.presentation.create_project(
        body={
            "title": "Python 演示",
            "document": presentation_document(),
        }
    )
    await client.presentation.apply_presentation_operations(
        project_id=project.id,
        body=edit_batch(
            project.revision,
            entity_edit(
                "slide",
                "update",
                project.document.slides[0].id,
                value={"notes": "讲稿已更新"},
            ),
        ),
    )
    saved = await client.presentation.get_project(project_id=project.id)
    async with await client.presentation.export_pptx(
        project_id=project.id,
        body={"expected_revision": saved.revision},
    ) as download:
        await download.save(output)
    return project.id, saved
```

## 录音标注

```python
async def annotation_workflow(client, source, output):
    asset = await client.files.upload_file(
        body={},
        files={"upload": ("recording.wav", source, "audio/wav")},
    )
    project = await client.annotation.create_project(
        body={"title": "Python 标注", "asset_id": asset.id}
    )
    document = await client.annotation.get_document(project_id=project.id)
    await client.annotation.apply_annotation_operations(
        project_id=project.id,
        body=edit_batch(
            document.revision,
            entity_edit(
                "speaker", "insert", "speaker-1", value={"name": "讲述者", "color": "#405c80"}
            ),
            entity_edit(
                "segment",
                "update",
                document.segments[0].id,
                value={
                    "text": "已校对的原文",
                    "speaker_id": "speaker-1",
                    "speaker_ids": ["speaker-1"],
                },
            ),
        ),
    )
    saved = await client.annotation.get_document(project_id=project.id)
    async with await client.annotation.export_annotation(
        project_id=project.id,
        expected_revision=saved.revision,
        format="srt",
    ) as download:
        await download.save(output)
    return project.id, saved
```

