"""Editable infographic recipe using only the public SDK. No backend dependency."""


async def thought_canvas_example(client, knowledge_base_id, output, *, image_asset_id=None):
    """Create an editable infographic in an explicitly selected personal library.

    image_asset_id, when supplied, must identify an uploaded image in the client's
    Account public file library. output is caller-selected Markdown/ZIP output.
    A revision conflict is returned to the caller without retrying note creation.
    """
    library = await client.thought.knowledge_base(project_id=knowledge_base_id)
    elements = [
        {
            "id": "input",
            "kind": "rounded",
            "x": 0,
            "y": 0,
            "width": 160,
            "height": 80,
            "text": "请求入口",
            "fill": "#effaf8",
            "stroke": "#365f62",
        },
        {
            "id": "store",
            "kind": "icon",
            "icon": "database",
            "x": 260,
            "y": 0,
            "width": 160,
            "height": 80,
            "text": "Account 数据",
            "fill": "#effaf8",
            "stroke": "#365f62",
        },
    ]
    if image_asset_id:
        elements.append(
            {
                "id": "illustration",
                "kind": "image",
                "assetId": image_asset_id,
                "x": 90,
                "y": 130,
                "width": 240,
                "height": 160,
                "text": "说明图片",
                "fill": "#ffffff",
                "stroke": "#365f62",
            }
        )
    note = await client.thought.create_note(
        body={
            "knowledge_base_id": library.id,
            "expected_knowledge_revision": library.revision,
            "title": "SDK 信息图示例",
            "document": {
                "type": "doc",
                "content": [
                    {
                        "type": "canvas",
                        "attrs": {
                            "scene": {
                                "sceneVersion": 1,
                                "title": "请求与持久化",
                                "elements": elements,
                                "edges": [
                                    {
                                        "id": "write",
                                        "source": "input",
                                        "target": "store",
                                        "label": "校验后写入",
                                        "arrow": True,
                                        "style": "step",
                                    }
                                ],
                            }
                        },
                    }
                ],
            },
        }
    )
    async with await client.thought.export_note_content(
        note_id=note.id, expected_revision=note.revision, format="md"
    ) as download:
        await download.save(output)
    return note.id, note
