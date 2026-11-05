import io
import json
import zipfile

import httpx
import pytest
from tests.test_account_system import create_test_account, login_and_change_password, unsafe_headers
from tests.test_thought_workshop import document, note_body
from tests.thought_helpers import create_note, delete_note

from app.main import app

ROOT = "/v1/thought-workshop"


@pytest.mark.asyncio
async def test_history_save_pagination_restore_and_backup():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        note = (await create_note(c, json={"title": "第一版", "document": document("原文")})).json()
        path = ROOT + "/notes/" + note["id"]
        first = (await c.get(path + "/history")).json()["items"][0]
        assert first["source"] == "create"
        home = (await c.get(ROOT + "/knowledge-bases/" + note["knowledge_base_id"])).json()[
            "home_note_id"
        ]
        assert len((await c.get(ROOT + "/notes/" + home + "/history")).json()["items"]) == 1
        note = (
            await c.put(
                path,
                json={**note_body(note), "expected_revision": note["revision"], "favorite": True},
            )
        ).json()
        assert len((await c.get(path + "/history")).json()["items"]) == 1
        note = (
            await c.put(
                path,
                json={**note_body(note), "expected_revision": note["revision"]},
            )
        ).json()
        assert len((await c.get(path + "/history")).json()["items"]) == 1
        for value in ["第二版", "第三版"]:
            response = await c.put(
                path,
                json={
                    **note_body(note),
                    "title": value,
                    "document": document(value),
                    "expected_revision": note["revision"],
                },
            )
            assert response.status_code == 200, response.text
            note = response.json()
        page = (await c.get(path + "/history", params={"limit": 2})).json()
        assert len(page["items"]) == 2 and page["next_cursor"]
        tail = (await c.get(path + "/history", params={"cursor": page["next_cursor"]})).json()
        assert tail["items"][0]["id"] == first["id"] and tail["next_cursor"] is None
        detail = (await c.get(path + "/history/" + page["items"][0]["id"])).json()
        assert detail["current"]["title"] == "第三版" and detail["previous"]["title"] == "第二版"
        restore = path + "/history/" + first["id"] + "/restore"
        assert (await c.post(restore, json={})).status_code == 422
        assert (await c.post(restore, json={"expected_revision": 0})).status_code == 409
        assert len((await c.get(path + "/history")).json()["items"]) == 3
        note = (await c.post(restore, json={"expected_revision": note["revision"]})).json()
        assert note["title"] == "第一版" and note["favorite"] is True
        items = (await c.get(path + "/history")).json()["items"]
        assert len(items) == 4 and items[0]["source"] == "restore"
        backup = await c.get(
            ROOT + "/backup", params={"knowledge_base_id": note["knowledge_base_id"]}
        )
        imported = await c.post(
            ROOT + "/imports", files={"upload": ("backup.zip", backup.content, "application/zip")}
        )
        assert imported.status_code == 200, imported.text
        copy_id = imported.json()["note_ids"][0]
        copied = (await c.get(ROOT + f"/notes/{copy_id}/history")).json()["items"]
        assert len(copied) == 5 and copied[0]["source"] == "import"
        assert all(item["author_id"] is None for item in copied[1:])
        # Corrupted history ownership must fail before persistence.
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
        manifest["history"][0]["note_id"] = "foreign-note"
        broken = io.BytesIO()
        with zipfile.ZipFile(broken, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
        assert (
            await c.post(
                ROOT + "/imports",
                files={"upload": ("bad.zip", broken.getvalue(), "application/zip")},
            )
        ).status_code == 422


@pytest.mark.asyncio
async def test_history_only_attachment_retained_until_purge_and_roundtrips():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        asset = (
            await c.post(
                ROOT + "/attachments", files={"upload": ("old.txt", b"old content", "text/plain")}
            )
        ).json()
        body = {
            "type": "doc",
            "content": [{"type": "attachment", "attrs": {"assetId": asset["asset_id"]}}],
        }
        note = (await create_note(c, json={"document": body})).json()
        path = ROOT + "/notes/" + note["id"]
        note = (
            await c.put(
                path,
                json={
                    **note_body(note),
                    "document": document("已移除附件"),
                    "expected_revision": 0,
                },
            )
        ).json()
        assert (
            await c.delete("/v1/files/" + asset["asset_id"], params={"expected_revision": 0})
        ).status_code == 409
        backup = await c.get(
            ROOT + "/backup", params={"knowledge_base_id": note["knowledge_base_id"]}
        )
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            assert archive.read("assets/" + asset["asset_id"]) == b"old content"
        imported = await c.post(
            ROOT + "/imports", files={"upload": ("backup.zip", backup.content, "application/zip")}
        )
        assert imported.status_code == 200, imported.text
        copy_path = ROOT + "/notes/" + imported.json()["note_ids"][0]
        history = (await c.get(copy_path + "/history")).json()["items"]
        old = (await c.get(copy_path + "/history/" + history[-1]["id"])).json()["current"]
        assert old["document"]["content"][0]["attrs"]["assetId"] != asset["asset_id"]
        deleted = (
            await delete_note(c, path, params={"expected_revision": note["revision"]})
        ).json()
        assert len((await c.get(path + "/history")).json()["items"]) == 2
        assert (
            await delete_note(
                c, path, params={"expected_revision": deleted["revision"], "permanent": True}
            )
        ).status_code == 200
        assert (await c.get(path + "/history")).status_code == 404
        assert (
            await c.delete("/v1/files/" + asset["asset_id"], params={"expected_revision": 0})
        ).status_code == 200


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_history_author_and_workspace_isolation():
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as a,
        httpx.AsyncClient(transport=transport, base_url="http://test") as b,
    ):
        await login_and_change_password(a, *(await create_test_account()))
        await login_and_change_password(b, *(await create_test_account()))
        note = (await create_note(a, headers=unsafe_headers(a), json={"title": "私密历史"})).json()
        path = ROOT + "/notes/" + note["id"] + "/history"
        row = (await a.get(path)).json()["items"][0]
        assert row["author_id"] and row["author_name"] != "未知编辑者"
        assert (await b.get(path)).status_code == 404
        assert (await b.get(path + "/" + row["id"])).status_code == 404
        assert (
            await b.post(
                path + "/" + row["id"] + "/restore",
                headers=unsafe_headers(b),
                json={"expected_revision": 0},
            )
        ).status_code == 404


@pytest.mark.asyncio
async def test_history_failure_rolls_back_document(monkeypatch):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
    ) as c:
        note = (await create_note(c, json={"title": "事务原文"})).json()
        path = ROOT + "/notes/" + note["id"]

        async def fail(*_args, **_kwargs):
            raise RuntimeError("isolated snapshot failure")

        with monkeypatch.context() as patch:
            patch.setattr("studio.apps.thought_workshop.history.History.append", fail)
            response = await c.put(
                path, json={**note_body(note), "title": "不应保存", "expected_revision": 0}
            )
            assert response.status_code == 500
        assert (await c.get(path)).json()["title"] == "事务原文"
        assert len((await c.get(path + "/history")).json()["items"]) == 1
