import io
import json
import zipfile

import httpx
import pytest
from PIL import Image
from tests.test_thought_workshop import note_body
from tests.thought_helpers import delete_note

from app.main import app

ROOT = "/v1/thought-workshop"


@pytest.mark.asyncio
async def test_directory_cas_cycles_moves_home_protection_and_restore():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        p = (await c.post(ROOT + "/knowledge-bases", json={"title": "研究"})).json()
        base = ROOT + "/knowledge-bases/" + p["id"]
        assert p["document_count"] == 0
        assert p["updated_at"].endswith(("Z", "+00:00"))
        home = (await c.get(ROOT + "/notes/" + p["home_note_id"])).json()
        assert home["is_home"] and home["document"] == {
            "type": "doc",
            "content": [{"type": "paragraph"}],
        }
        assert (
            await delete_note(c, ROOT + "/notes/" + home["id"], params={"expected_revision": 0})
        ).status_code == 422

        async def tree():
            r = await c.get(base + "/directory")
            assert r.status_code == 200, r.text
            return r.json()

        async def rev():
            return (await tree())["knowledge_base"]["revision"]

        r = await c.post(
            base + "/documents", json={"title": "一级", "expected_revision": await rev()}
        )
        assert r.status_code == 200, r.text
        parent = r.json()
        r = await c.post(
            base + "/documents",
            json={
                "title": "二级",
                "parent_id": parent["id"],
                "expected_revision": await rev(),
            },
        )
        assert r.status_code == 200, r.text
        child = r.json()
        assert (
            await c.post(
                base + "/move",
                json={
                    "item_id": parent["id"],
                    "parent_id": child["id"],
                    "expected_revision": await rev(),
                },
            )
        ).status_code == 422
        revision = await rev()
        assert (
            await c.post(
                base + "/documents",
                json={
                    "title": "中文文档",
                    "parent_id": parent["id"],
                    "expected_revision": revision,
                },
            )
        ).status_code == 200
        assert (
            await c.post(base + "/documents", json={"expected_revision": revision})
        ).status_code == 409
        note = next(d for d in (await tree())["documents"] if d["title"] == "中文文档")
        old = (await c.get(ROOT + "/notes/" + note["id"])).json()
        assert (
            await c.post(
                base + "/move",
                json={
                    "item_id": note["id"],
                    "parent_id": child["id"],
                    "expected_revision": await rev(),
                },
            )
        ).status_code == 200
        assert (
            await c.put(
                ROOT + "/notes/" + note["id"],
                json={**note_body(old), "expected_revision": old["revision"]},
            )
        ).status_code == 409
        assert (
            await c.post(
                base + "/move",
                json={
                    "item_id": home["id"],
                    "parent_id": parent["id"],
                    "expected_revision": await rev(),
                },
            )
        ).status_code == 422
        # Delete parent only: children lift to root.
        parent = (await c.get(ROOT + "/notes/" + parent["id"])).json()
        assert (
            await delete_note(
                c,
                ROOT + "/notes/" + parent["id"],
                params={"expected_revision": parent["revision"]},
            )
        ).status_code == 200
        tree_docs = (await tree())["documents"]
        child_now = next(d for d in tree_docs if d["id"] == child["id"])
        assert child_now["parent_id"] is None
        n = (await c.get(ROOT + "/notes/" + note["id"])).json()
        trashed = (
            await delete_note(
                c, ROOT + "/notes/" + n["id"], params={"expected_revision": n["revision"]}
            )
        ).json()
        deleted = await c.delete(base, params={"expected_revision": await rev()})
        assert deleted.status_code == 200
        assert (await c.get(base + "/directory")).status_code == 404
        assert (await c.get(ROOT + "/notes/" + home["id"])).status_code == 404
        assert (
            await c.post(base + "/restore", json={"expected_revision": deleted.json()["revision"]})
        ).status_code == 200
        assert (await c.get(ROOT + "/notes/" + n["id"])).json()["deleted_at"] == trashed[
            "deleted_at"
        ]
        assert (
            await c.get(ROOT + "/notes", params={"knowledge_base_id": p["id"], "view": "trash"})
        ).json()["total"] == 2
        assert (await c.get(ROOT + "/notes")).status_code == 422
        assert (await c.get(ROOT + "/notebooks")).status_code == 404
        assert (
            await c.post(base + "/folders", json={"title": "x", "expected_revision": 0})
        ).status_code == 404


@pytest.mark.asyncio
async def test_cascade_delete_trashes_subtree():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        p = (await c.post(ROOT + "/knowledge-bases", json={"title": "子树"})).json()
        base = ROOT + "/knowledge-bases/" + p["id"]
        parent = (
            await c.post(base + "/documents", json={"title": "父", "expected_revision": 0})
        ).json()
        child = (
            await c.post(
                base + "/documents",
                json={
                    "title": "子",
                    "parent_id": parent["id"],
                    "expected_revision": 1,
                },
            )
        ).json()
        parent = (await c.get(ROOT + "/notes/" + parent["id"])).json()
        assert (
            await delete_note(
                c,
                ROOT + "/notes/" + parent["id"],
                params={
                    "expected_revision": parent["revision"],
                    "cascade_children": True,
                },
            )
        ).status_code == 200
        tree = (await c.get(base + "/directory")).json()
        assert tree["documents"] == []
        assert (await c.get(ROOT + "/notes/" + child["id"])).json()["deleted_at"] is not None


@pytest.mark.asyncio
async def test_cover_protection_and_v3_single_project_roundtrip():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        image = io.BytesIO()
        Image.new("RGB", (16, 16), "orange").save(image, "PNG")
        asset = (
            await c.post(
                ROOT + "/images", files={"upload": ("cover.png", image.getvalue(), "image/png")}
            )
        ).json()["asset_id"]
        p = (
            await c.post(
                ROOT + "/knowledge-bases",
                json={"title": "封面知识库", "cover_asset_id": asset, "description": "完整备份"},
            )
        ).json()
        base = ROOT + "/knowledge-bases/" + p["id"]
        assert (
            await c.delete("/v1/files/" + asset, params={"expected_revision": 0})
        ).status_code == 409
        backup = await c.get(ROOT + "/backup", params={"knowledge_base_id": p["id"]})
        assert backup.status_code == 200, backup.text
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["version"] == 9 and len(manifest["knowledge_bases"]) == 1
            assert archive.read("assets/" + asset) == image.getvalue()
            assert manifest["folders"] == []
        restored = await c.post(
            ROOT + "/imports", files={"upload": ("backup.zip", backup.content, "application/zip")}
        )
        assert restored.status_code == 200, restored.text
        copy = (
            await c.get(ROOT + "/knowledge-bases/" + restored.json()["knowledge_base_ids"][0])
        ).json()
        assert (
            copy["id"] != p["id"]
            and copy["home_note_id"] != p["home_note_id"]
            and copy["cover_asset_id"] != asset
        )
        assert (
            await c.get("/v1/files/" + copy["cover_asset_id"] + "/download")
        ).content == image.getvalue()
        deleted = (await c.delete(base, params={"expected_revision": 0})).json()
        assert deleted["deleted_at"]
        assert (
            await c.delete("/v1/files/" + asset, params={"expected_revision": 0})
        ).status_code == 409


def test_runtime_contract_has_no_notebook_model_or_api():
    from pathlib import Path

    from app.main import app

    assert not any("notebook" in path for path in app.openapi()["paths"])
    for path in [
        "backend/studio/apps/thought_workshop/storage/models.py",
        "backend/studio/apps/thought_workshop/schemas/workshop.py",
        "backend/studio/apps/thought_workshop/notes.py",
        "web/src/features/thought-workshop/api.ts",
        "web/src/features/thought-workshop/queryKeys.ts",
    ]:
        source = Path(path).read_text()
        assert "notebook_id" not in source and "ThoughtNotebook" not in source
    assert (
        "ThoughtFolder"
        not in Path("backend/studio/apps/thought_workshop/storage/models.py").read_text()
    )


@pytest.mark.asyncio
async def test_v4_nested_directory_roundtrip_and_rejected_cycle_import():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        p = (await c.post(ROOT + "/knowledge-bases", json={"title": "层级备份"})).json()
        base = ROOT + "/knowledge-bases/" + p["id"]
        first = (
            await c.post(base + "/documents", json={"title": "一级", "expected_revision": 0})
        ).json()
        second = (
            await c.post(
                base + "/documents",
                json={
                    "title": "二级",
                    "parent_id": first["id"],
                    "expected_revision": 1,
                },
            )
        ).json()
        note = (
            await c.post(
                base + "/documents",
                json={"title": "归属", "parent_id": second["id"], "expected_revision": 2},
            )
        ).json()
        assert (
            await delete_note(c, ROOT + "/notes/" + note["id"], params={"expected_revision": 0})
        ).status_code == 200
        stale = await c.post(base + "/move", json={"item_id": second["id"], "expected_revision": 3})
        assert stale.status_code == 409  # Document trash also reserves the directory revision.
        backup = await c.get(ROOT + "/backup", params={"knowledge_base_id": p["id"]})
        copied = await c.post(
            ROOT + "/imports", files={"upload": ("v4.zip", backup.content, "application/zip")}
        )
        assert copied.status_code == 200, copied.text
        new_base = ROOT + "/knowledge-bases/" + copied.json()["knowledge_base_ids"][0]
        tree = (await c.get(new_base + "/directory")).json()
        new_child = next(d for d in tree["documents"] if d["parent_id"] and d["title"] == "二级")
        assert new_child["id"] != second["id"] and new_child["title"] == "二级"
        restored = None
        for note_id in copied.json()["note_ids"]:
            candidate = (await c.get(ROOT + "/notes/" + note_id)).json()
            if candidate["deleted_at"]:
                restored = candidate
                break
        assert restored and restored["parent_id"] == new_child["id"] and restored["title"] == "归属"
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
        nested = next(n for n in manifest["notes"] if n.get("title") == "二级")
        nested["parent_id"] = nested["id"]
        broken = io.BytesIO()
        with zipfile.ZipFile(broken, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
        before = (await c.get(ROOT + "/knowledge-bases")).json()
        assert (
            await c.post(
                ROOT + "/imports",
                files={"upload": ("broken.zip", broken.getvalue(), "application/zip")},
            )
        ).status_code == 422
        assert (await c.get(ROOT + "/knowledge-bases")).json() == before
