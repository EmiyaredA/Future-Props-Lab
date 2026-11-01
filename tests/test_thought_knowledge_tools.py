"""Full document workflows through public APIs against the isolated test database."""

import copy
import io
import json
import zipfile

import httpx
import pytest
from tests.test_account_system import create_test_account, login_and_change_password, unsafe_headers

from app.main import app

ROOT = "/v1/thought-workshop"


def doc(text):
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


def ref(note):
    return {
        "type": "documentReference",
        "attrs": {"kind": "note", "noteId": note["id"], "label": note["title"]},
    }


async def project(c, title="知识库"):
    result = await c.post(ROOT + "/knowledge-bases", json={"title": title})
    assert result.status_code == 200, result.text
    return result.json()


async def note(c, p, title, document=None, parent=None):
    current = (await c.get(ROOT + "/knowledge-bases/" + p["id"])).json()
    result = await c.post(
        ROOT + "/notes",
        json={
            "knowledge_base_id": p["id"],
            "expected_knowledge_revision": current["revision"],
            "title": title,
            "document": document or doc(title),
            "parent_id": parent,
            "schema_version": 3,
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


async def put(c, n, **patch):
    result = await c.put(
        ROOT + "/notes/" + n["id"],
        json={
            **{
                k: n[k]
                for k in (
                    "title",
                    "knowledge_base_id",
                    "parent_id",
                    "document",
                    "schema_version",
                    "tags",
                    "favorite",
                    "pinned",
                )
            },
            **patch,
            "expected_revision": n["revision"],
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


@pytest.mark.asyncio
async def test_reference_rename_backlink_and_deleted_target_retention():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        p = await project(c)
        target = await note(c, p, "引用目标")
        document = doc("参考 ")
        document["content"][0]["content"].append(ref(target))
        source = await note(c, p, "来源", document)
        links = await c.get(ROOT + f"/notes/{target['id']}/backlinks")
        assert [item["id"] for item in links.json()] == [source["id"]]
        target = await put(c, target, title="改名仍可引用")
        resolved = await c.post(
            ROOT + "/references/resolve", json={"ids": [target["id"], "missing"]}
        )
        assert resolved.json()[0]["title"] == "改名仍可引用"
        assert resolved.json()[1] == {
            "id": "missing",
            "available": False,
            "title": "",
            "knowledge_base_id": None,
            "excerpt": "",
            "revision": None,
        }
        rev = (await c.get(ROOT + "/knowledge-bases/" + p["id"])).json()["revision"]
        deleted = await c.delete(
            ROOT + "/notes/" + target["id"],
            params={"expected_revision": target["revision"], "expected_knowledge_revision": rev},
        )
        assert deleted.status_code == 200, deleted.text
        source = await put(c, source, title="目标删除后仍可编辑")
        assert source["document"]["content"][0]["content"][1]["attrs"]["noteId"] == target["id"]
        assert not (
            await c.post(ROOT + "/references/resolve", json={"ids": [target["id"]]})
        ).json()[0]["available"]


@pytest.mark.asyncio
async def test_subtree_copy_remaps_internal_references_and_stale_copy_is_atomic():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        p = await project(c, "来源库")
        root = await note(c, p, "父文档")
        child = await note(c, p, "子文档", parent=root["id"])
        document = doc("链接 ")
        document["content"][0]["content"].append(ref(child))
        root = await put(c, root, document=document, favorite=True, pinned=True)
        target = await project(c, "目标库")
        snapshot = (
            await c.get(ROOT + f"/notes/{root['id']}/copy-snapshot", params={"subtree": True})
        ).json()
        body = {
            "knowledge_base_id": target["id"],
            "subtree": True,
            "source_knowledge_revision": snapshot["knowledge_revision"],
            "expected_knowledge_revision": target["revision"],
            "expected_revisions": snapshot["revisions"],
        }
        copied = await c.post(ROOT + f"/notes/{root['id']}/duplicate", json=body)
        assert copied.status_code == 200, copied.text
        new = (await c.get(ROOT + "/notes/" + copied.json()["root_id"])).json()
        new_child = new["document"]["content"][0]["content"][1]["attrs"]["noteId"]
        assert new_child != child["id"] and new_child in copied.json()["note_ids"]
        assert (await c.get(ROOT + "/notes/" + new_child)).json()["parent_id"] == new["id"]
        assert not new["favorite"] and not new["pinned"]
        await put(c, child, title="来源已变化")
        body["expected_knowledge_revision"] = (
            await c.get(ROOT + "/knowledge-bases/" + target["id"])
        ).json()["revision"]
        before = (await c.get(ROOT + "/knowledge-bases/" + target["id"] + "/directory")).json()
        stale = await c.post(ROOT + f"/notes/{root['id']}/duplicate", json=body)
        assert stale.status_code == 409, stale.text
        assert (
            await c.get(ROOT + "/knowledge-bases/" + target["id"] + "/directory")
        ).json() == before


@pytest.mark.asyncio
async def test_templates_checkpoints_and_version_seven_backup_roundtrip():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        p = await project(c)
        n = await note(
            c,
            p,
            "模板原文",
            {
                "type": "doc",
                "content": [
                    {
                        "type": "callout",
                        "attrs": {"variant": "warning"},
                        "content": doc("注意中文内容")["content"],
                    }
                ],
            },
        )
        template = await c.post(
            ROOT + "/templates", json={"name": "独立模板", "document": n["document"]}
        )
        assert template.status_code == 200, template.text
        t = template.json()
        changed = await c.put(
            ROOT + "/templates/" + t["id"],
            json={"name": "新名称", "document": t["document"], "expected_revision": 0},
        )
        assert changed.status_code == 200, changed.text
        assert (
            await c.put(
                ROOT + "/templates/" + t["id"],
                json={"name": "旧写入", "document": t["document"], "expected_revision": 0},
            )
        ).status_code == 409
        n = await put(c, n, document=doc("修改原文不会改变模板"))
        assert (await c.get(ROOT + "/templates")).json()[0]["document"] == t["document"]
        history = (await c.get(ROOT + f"/notes/{n['id']}/history")).json()["items"]
        checkpoint = await c.post(
            ROOT + f"/notes/{n['id']}/checkpoints",
            json={
                "name": "交付版",
                "history_id": history[0]["id"],
                "expected_note_revision": n["revision"],
            },
        )
        assert checkpoint.status_code == 200, checkpoint.text
        payload = (await c.get(ROOT + "/backup")).content
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
        assert manifest["version"] == 9 and manifest["templates"] and manifest["checkpoints"]
        imported = await c.post(
            ROOT + "/imports", files={"upload": ("backup.zip", payload, "application/zip")}
        )
        assert imported.status_code == 200, imported.text
        ids = imported.json()["note_ids"]
        copies = [(await c.get(ROOT + "/notes/" + id)).json() for id in ids]
        copied = next(item for item in copies if item["title"] == n["title"])
        marks = (await c.get(ROOT + f"/notes/{copied['id']}/checkpoints")).json()
        assert marks[0]["name"] == "交付版" and marks[0]["history_id"] != history[0]["id"]
        corrupt = copy.deepcopy(manifest)
        corrupt["checkpoints"][0]["history_id"] = "not-in-backup"
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("manifest.json", json.dumps(corrupt))
        before = (await c.get(ROOT + "/knowledge-bases")).json()
        failed = await c.post(
            ROOT + "/imports", files={"upload": ("bad.zip", stream.getvalue(), "application/zip")}
        )
        assert failed.status_code == 422
        assert (await c.get(ROOT + "/knowledge-bases")).json() == before


@pytest.mark.asyncio
async def test_chinese_search_ranking_snippets_and_literal_wildcards():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        p = await project(c)
        title = await note(c, p, "特殊检索词标题")
        tagged = await note(c, p, "只有中文标签")
        tagged = await put(c, tagged, tags=["特殊检索词"])
        await note(c, p, "正文命中", doc("前缀" * 300 + "特殊检索词" + "后缀" * 300))
        result = (await c.get(ROOT + "/search", params={"query": "特殊检索词"})).json()
        assert result["items"][0]["id"] == title["id"]
        assert (
            "特殊检索词" in result["items"][2]["snippet"]
            and len(result["items"][2]["snippet"]) <= 242
        )
        assert result["items"][1]["id"] == tagged["id"]
        assert (
            await c.get(ROOT + "/search", params={"query": "特殊检索词", "title_only": True})
        ).json()["total"] == 1
        assert (await c.get(ROOT + "/search", params={"query": "%_not_a_wildcard"})).json()[
            "total"
        ] == 0


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_personal_preferences_and_references_are_account_workspace_scoped():
    accounts = [await create_test_account() for _ in range(2)]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        await login_and_change_password(c, *accounts[0])
        c.headers.update(unsafe_headers(c))
        p = await project(c)
        n = await note(c, p, "个人阅读")
        saved = await c.post(
            ROOT + "/preferences/filters", json={"name": "我的收藏", "criteria": {"favorite": True}}
        )
        assert saved.status_code == 200, saved.text
        reading = await c.post(
            ROOT + "/preferences/reading",
            json={
                "resource_id": n["id"],
                "title": n["title"],
                "position": {"paragraph": "原段落", "ratio": 0.6, "note_revision": n["revision"]},
            },
        )
        assert reading.status_code == 200, reading.text
        assert (await c.get(ROOT + "/notes/" + n["id"])).json()["revision"] == n["revision"]
        assert (await c.get(ROOT + "/preferences/recent")).json()[0]["resource_id"] == n["id"]
        await login_and_change_password(c, *accounts[1])
        c.headers.update(unsafe_headers(c))
        assert (await c.get(ROOT + "/preferences/filters")).json() == []
        assert (await c.get(ROOT + "/preferences/recent")).json() == []
        assert not (await c.post(ROOT + "/references/resolve", json={"ids": [n["id"]]})).json()[0][
            "available"
        ]
        assert (
            await c.get(ROOT + "/preferences/reading", params={"resource_id": n["id"]})
        ).status_code == 404
        assert (await c.get(ROOT + "/search", params={"query": n["title"]})).json()["total"] == 0


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_personal_preferences_do_not_open_another_accounts_snapshot():
    from contextlib import aclosing

    from tests.test_workspace_governance import client_account

    owner, *_ = await client_account()
    other, *_ = await client_account()
    async with aclosing(owner), aclosing(other):
        p = await project(owner)
        n = await note(owner, p, "私人文章")
        saved = await other.post(
            ROOT + "/preferences/filters", json={"name": "我的筛选", "criteria": {"query": "私人"}}
        )
        assert saved.status_code == 200, saved.text
        assert (await owner.get(ROOT + "/preferences/filters")).json() == []
        assert (
            await other.get(ROOT + f"/knowledge-bases/{p['id']}/export-snapshot")
        ).status_code == 404
        assert (
            await other.post(
                ROOT + "/preferences/reading", json={"resource_id": n["id"], "title": n["title"]}
            )
        ).status_code == 404
