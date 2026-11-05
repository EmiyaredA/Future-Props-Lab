"""New knowledge operations form a standalone SDK workflow, not only a method list."""

import sys
from pathlib import Path

import httpx
import pytest

from website_test_support import app

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sdk/python/src"))
from future_props_lab import AsyncClient  # noqa: E402


@pytest.mark.asyncio
async def test_sdk_template_copy_checkpoint_search_and_export_snapshot():
    async with AsyncClient(
        base_url="http://test", transport=httpx.ASGITransport(app=app)
    ) as client:
        library = await client.thought.create_knowledge_base(body={"title": "SDK 知识库"})
        template = await client.thought.create_template(
            body={
                "name": "SDK 模板",
                "tags": ["SDK"],
                "document": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "callout",
                            "attrs": {"variant": "info"},
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "知识工作流"}],
                                }
                            ],
                        }
                    ],
                },
            }
        )
        note = await client.thought.apply_template(
            template_id=template.id,
            body={
                "expected_revision": template.revision,
                "knowledge_base_id": library.id,
                "expected_knowledge_revision": library.revision,
                "title": "SDK 生成文档",
            },
        )
        history = await client.thought.note_history(note_id=note.id)
        mark = await client.thought.create_checkpoint(
            note_id=note.id,
            body={
                "name": "SDK 验收",
                "history_id": history.items[0].id,
                "expected_note_revision": note.revision,
            },
        )
        assert (await client.thought.checkpoints(note_id=note.id))[0].id == mark.id
        source = await client.thought.copy_snapshot(note_id=note.id)
        directory = await client.thought.directory(project_id=library.id)
        copy = await client.thought.duplicate_document(
            note_id=note.id,
            body={
                "knowledge_base_id": library.id,
                "source_knowledge_revision": source.knowledge_revision,
                "expected_knowledge_revision": directory.knowledge_base.revision,
                "expected_revisions": source.revisions,
            },
        )
        assert copy.root_id != note.id
        search = await client.thought.global_search(query="知识工作流", tag="SDK")
        assert {item.id for item in search.items} == {note.id, copy.root_id}
        snapshot = await client.thought.library_export_snapshot(project_id=library.id)
        assert {item["id"] for item in snapshot.documents} >= {note.id, copy.root_id}
        resolved = await client.thought.resolve_references(body={"ids": [note.id, "missing"]})
        assert resolved[0].title == note.title and not resolved[1].available
