from __future__ import annotations

import io
import json
import zipfile

import httpx
import pytest
from PIL import Image
from tests.thought_helpers import all_notes, create_note, delete_note

from app.main import app

ROOT = "/v1/thought-workshop"


def document(text="笔记测试"):
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


def note_body(note):
    return {
        key: note[key]
        for key in (
            "title",
            "knowledge_base_id",
            "folder_id",
            "schema_version",
            "document",
            "tags",
            "pinned",
            "favorite",
        )
    }


@pytest.mark.asyncio
async def test_images_backup_roundtrip_and_reference_guards():
    image = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(image, format="PNG")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        uploaded = await client.post(
            ROOT + "/images", files={"upload": ("image.png", image.getvalue(), "image/png")}
        )
        assert uploaded.status_code == 200, uploaded.text
        asset_id = uploaded.json()["asset_id"]
        rich = document("备份")
        rich["content"].extend(
            [
                {"type": "image", "attrs": {"assetId": asset_id, "width": 320, "alt": "红色"}},
                {"type": "blockMath", "attrs": {"latex": "x^2"}},
                {"type": "mermaid", "attrs": {"source": "graph TD; A-->B"}},
            ]
        )
        note = (await create_note(client, json={"title": "备份笔记", "document": rich})).json()
        blocked = await client.delete(f"/v1/files/{asset_id}", params={"expected_revision": 0})
        assert blocked.status_code == 409, blocked.text
        await delete_note(client, ROOT + f"/notes/{note['id']}", params={"expected_revision": 0})
        blocked = await client.delete(f"/v1/files/{asset_id}", params={"expected_revision": 0})
        assert blocked.status_code == 409
        backup = await client.get(ROOT + "/backup")
        assert backup.status_code == 200, backup.text
        imported = await client.post(
            ROOT + "/imports", files={"upload": ("backup.zip", backup.content, "application/zip")}
        )
        assert imported.status_code == 200, imported.text
        ids = imported.json()["note_ids"]
        assert note["id"] not in ids
        copies = [(await client.get(ROOT + f"/notes/{nid}")).json() for nid in ids]
        copy = next(n for n in copies if n["title"] == "备份笔记")
        assert copy["deleted_at"]
        assert copy["document"]["content"][1]["attrs"]["assetId"] != asset_id
        assert copy["document"]["content"][2:] == rich["content"][2:]
        await delete_note(
            client,
            ROOT + f"/notes/{note['id']}",
            params={"expected_revision": 1, "permanent": True},
        )
        assert (
            await client.delete(f"/v1/files/{asset_id}", params={"expected_revision": 0})
        ).status_code == 200


@pytest.mark.asyncio
async def test_invalid_documents_and_archive_are_atomic():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        bad = document()
        bad["content"][0]["content"][0]["marks"] = [
            {"type": "link", "attrs": {"href": "javascript:alert(1)"}}
        ]
        assert (await create_note(client, json={"document": bad})).status_code == 422
        missing = {"type": "doc", "content": [{"type": "image", "attrs": {"assetId": "foreign"}}]}
        assert (await create_note(client, json={"document": missing})).status_code == 404
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as target:
            target.writestr("../escape", "unsafe")
            target.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "format": "thought-workshop-backup",
                        "version": 1,
                        "notes": [],
                        "notebooks": [],
                        "assets": [],
                    }
                ),
            )
        before = len(await all_notes(client))
        response = await client.post(
            ROOT + "/imports", files={"upload": ("bad.zip", archive.getvalue(), "application/zip")}
        )
        assert response.status_code == 422, response.text
        assert len(await all_notes(client)) == before


@pytest.fixture(autouse=True)
async def clean_up_created_notes():
    """Use the public API so this module leaves no protected files for other suites."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:

        async def collection():
            return await all_notes(client)

        before = {n["id"] for n in await collection()}
        yield
        for note in await collection():
            if note["id"] in before:
                continue
            if not note["deleted_at"]:
                note = (
                    await delete_note(
                        client,
                        ROOT + f"/notes/{note['id']}",
                        params={"expected_revision": note["revision"]},
                    )
                ).json()
            await delete_note(
                client,
                ROOT + f"/notes/{note['id']}",
                params={"expected_revision": note["revision"], "permanent": True},
            )


@pytest.mark.asyncio
@pytest.mark.parametrize("asset_kind", ["image", "attachment"])
async def test_import_rolls_back_records_and_staged_files(monkeypatch, asset_kind):
    from app.files.library import AssetLibrary
    from app.thought_workshop.notes import Notes, ThoughtError

    staged = []
    original_stage = AssetLibrary.stage_local_copy
    original_create = Notes.create
    created = 0

    async def stage(self, *args, **kwargs):
        result = await original_stage(self, *args, **kwargs)
        staged.append(result[1])
        return result

    async def fail_second(self, body, *, commit=True, importing=False):
        nonlocal created
        created += 1
        if created == 2:
            raise ThoughtError("模拟提交阶段失败")
        return await original_create(self, body, commit=commit, importing=importing)

    monkeypatch.setattr(AssetLibrary, "stage_local_copy", stage)
    monkeypatch.setattr(Notes, "create", fail_second)
    image = io.BytesIO()
    Image.new("RGB", (4, 4), "blue").save(image, format="PNG")
    rich = {"type": "doc", "content": [{"type": asset_kind, "attrs": {"assetId": "a"}}]}
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as target:
        target.writestr("image.png", image.getvalue() if asset_kind == "image" else b"attachment")
        target.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format": "thought-workshop-backup",
                    "version": 1,
                    "notebooks": [{"id": "b", "title": "回滚笔记本"}],
                    "notes": [{"document": rich, "notebook_id": "b"}, {"document": document()}],
                    "assets": [
                        {
                            "id": "a",
                            "path": "image.png",
                            "filename": "image.png" if asset_kind == "image" else "file.txt",
                            "content_type": "image/png" if asset_kind == "image" else "text/plain",
                        }
                    ],
                }
            ),
        )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        before = len(await all_notes(client))
        books = (await client.get(ROOT + "/knowledge-bases")).json()
        result = await client.post(
            ROOT + "/imports",
            files={"upload": ("backup.zip", archive.getvalue(), "application/zip")},
        )
        assert result.status_code == 422, result.text
        assert len(await all_notes(client)) == before
        assert (await client.get(ROOT + "/knowledge-bases")).json() == books
        assert staged and all(not path.exists() for path in staged)


@pytest.mark.parametrize(
    "content",
    [
        [{"type": "listItem", "content": [{"type": "paragraph"}]}],
        [{"type": "paragraph", "content": [{"type": "table"}]}],
        [{"type": "bulletList", "content": [{"type": "paragraph"}]}],
        [{"type": "taskList", "content": [{"type": "taskItem", "content": [None]}]}],
        [
            {
                "type": "codeBlock",
                "content": [{"type": "text", "text": "code", "marks": [{"type": "bold"}]}],
            }
        ],
        [{"type": []}],
    ],
)
def test_invalid_node_grammar_is_rejected(content):
    from app.schemas.thought_workshop import ThoughtNoteIn

    with pytest.raises(ValueError):
        ThoughtNoteIn(document={"type": "doc", "content": content})
