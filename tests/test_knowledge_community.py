"""Community APIs exercise cross-Workspace roles against an isolated migrated database."""

import io
from contextlib import AsyncExitStack

import httpx
import pytest
from tests.test_account_system import create_test_account, login_and_change_password, unsafe_headers
from tests.test_thought_knowledge_tools import doc

from website_test_support import app

ROOT = "/v1/thought-workshop"
COMM = ROOT + "/community"
pytestmark = [pytest.mark.asyncio, pytest.mark.real_auth]


@pytest.fixture
async def community():
    async with AsyncExitStack() as stack:
        clients = []
        names = []
        for _ in range(3):
            username, password = await create_test_account()
            c = await stack.enter_async_context(
                httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
            )
            await login_and_change_password(c, username, password)
            c.headers.update(unsafe_headers(c))
            clients.append(c)
            names.append(username)
        owner, reader, other = clients
        p = (await owner.post(ROOT + "/knowledge-bases", json={"title": "共享测试"})).json()
        notes = []
        for title in ["私密父文档", "公开子文档", "成员限定"]:
            current = (await owner.get(ROOT + "/knowledge-bases/" + p["id"])).json()
            r = await owner.post(
                ROOT + "/notes",
                json={
                    "knowledge_base_id": p["id"],
                    "expected_knowledge_revision": current["revision"],
                    "title": title,
                    "document": doc(title),
                    "parent_id": notes[0]["id"] if len(notes) == 1 else None,
                },
            )
            assert r.status_code == 200, r.text
            notes.append(r.json())
        body = {
            "expected_revision": 0,
            "title": "社区测试",
            "read_only": False,
            "description": "简介",
            "articles": [
                {
                    "note_id": notes[1]["id"],
                    "expected_revision": 0,
                    "visibility": "public",
                    "members": [{"username": names[1], "role": "edit"}],
                },
                {
                    "note_id": notes[2]["id"],
                    "expected_revision": 0,
                    "visibility": "members",
                    "members": [{"username": names[1], "role": "manage"}],
                },
            ],
        }
        r = await owner.put(COMM + f"/libraries/{p['id']}/publication", json=body)
        assert r.status_code == 200, r.text
        try:
            yield clients, names, p, notes, r.json()
        finally:
            # Release attachment/history references through formal note trash/purge use cases.
            current = await owner.get(ROOT + f"/knowledge-bases/{p['id']}")
            if current.status_code != 200:
                trashed = (
                    await owner.get(ROOT + "/knowledge-bases", params={"trash": True})
                ).json()
                revision = next(row["revision"] for row in trashed if row["id"] == p["id"])
                restored = await owner.post(
                    ROOT + f"/knowledge-bases/{p['id']}/restore",
                    json={"expected_revision": revision},
                )
                assert restored.status_code == 200, restored.text
            for note in notes:
                current_note = await owner.get(ROOT + f"/notes/{note['id']}")
                if current_note.status_code == 404:
                    continue
                row = current_note.json()
                project = (await owner.get(ROOT + f"/knowledge-bases/{p['id']}")).json()
                if row["deleted_at"] is None:
                    removed = await owner.delete(
                        ROOT + f"/notes/{note['id']}",
                        params={
                            "expected_revision": row["revision"],
                            "expected_knowledge_revision": project["revision"],
                        },
                    )
                    assert removed.status_code == 200, removed.text
                    row = removed.json()
                    project = (await owner.get(ROOT + f"/knowledge-bases/{p['id']}")).json()
                purged = await owner.delete(
                    ROOT + f"/notes/{note['id']}",
                    params={
                        "expected_revision": row["revision"],
                        "expected_knowledge_revision": project["revision"],
                        "permanent": True,
                    },
                )
                assert purged.status_code == 200, purged.text
            project = (await owner.get(ROOT + f"/knowledge-bases/{p['id']}")).json()
            removed = await owner.delete(
                ROOT + f"/knowledge-bases/{p['id']}",
                params={"expected_revision": project["revision"]},
            )
            assert removed.status_code == 200, removed.text


async def test_roles_projection_live_edit_and_private_api_boundaries(community):
    (owner, reader, other), names, p, notes, config = community
    pub = config["publication"]["id"]
    base = COMM + f"/publications/{pub}"
    d = (await other.get(base)).json()
    assert len(d["documents"]) == 1
    assert d["documents"][0]["parent_id"] is None
    assert d["publication"]["document_count"] == 1
    assert (await other.get(base + f"/notes/{notes[0]['id']}")).status_code == 404
    assert (await other.get(base + f"/notes/{notes[2]['id']}")).status_code == 404
    assert (await reader.get(ROOT + f"/notes/{notes[1]['id']}")).status_code == 404
    assert (await reader.get(base + f"/notes/{notes[1]['id']}/history")).status_code == 404
    body = {
        "expected_revision": notes[1]["revision"],
        "title": "社区编辑保存",
        "document": doc("即时更新"),
        "tags": [],
    }
    assert (await other.put(base + f"/notes/{notes[1]['id']}", json=body)).status_code == 404
    saved = await reader.put(base + f"/notes/{notes[1]['id']}", json=body)
    assert saved.status_code == 200, saved.text
    original = (await owner.get(ROOT + f"/notes/{notes[1]['id']}")).json()
    assert original["title"] == "社区编辑保存"
    assert (await reader.put(base + f"/notes/{notes[1]['id']}", json=body)).status_code == 409
    history = await owner.get(ROOT + f"/notes/{notes[1]['id']}/history")
    assert history.status_code == 200
    snapshot = (await other.get(base + "/export-snapshot")).json()
    assert [n["id"] for n in snapshot["documents"]] == [notes[1]["id"]]
    assert notes[0]["title"] not in str(d)
    assert (
        await other.get(COMM + "/publications", params={"query": notes[2]["title"]})
    ).json() == []
    assert (
        await reader.put(
            COMM + f"/libraries/{p['id']}/publication",
            json={"expected_revision": 0, "title": "fake", "articles": []},
        )
    ).status_code == 422


async def test_navigation_cards_share_content_and_reject_hidden_targets(community):
    (owner, reader, other), _, p, notes, config = community
    base = COMM + f"/publications/{config['publication']['id']}"
    current = notes[1]

    def card(target):
        return {
            "type": "documentCard",
            "attrs": {"kind": "note", "noteId": target, "style": "standard", "eyebrow": ""},
        }

    body = {
        "expected_revision": current["revision"],
        "title": current["title"],
        "tags": [],
        "document": {
            "type": "doc",
            "content": [
                {"type": "cardGrid", "content": [card(notes[0]["id"])]},
                {"type": "documentDirectory", "attrs": {"parentId": None, "style": "cards"}},
            ],
        },
    }
    assert (await reader.put(base + f"/notes/{current['id']}", json=body)).status_code == 404
    body["document"]["content"][0]["content"] = [card(notes[2]["id"])]
    saved = await reader.put(base + f"/notes/{current['id']}", json=body)
    assert saved.status_code == 200, saved.text
    source = (await owner.get(ROOT + f"/notes/{current['id']}")).json()
    assert source["document"] == body["document"]
    assert source["revision"] == saved.json()["note"]["revision"]
    view = await other.get(base + f"/notes/{current['id']}")
    assert view.status_code == 200
    assert notes[0]["title"] not in view.text
    assert notes[2]["title"] not in view.text
    exported = (await other.get(base + "/export-snapshot")).json()
    assert len(exported["documents"]) == 1
    assert notes[2]["title"] not in str(exported)
    links = (await reader.get(base + f"/notes/{notes[2]['id']}/backlinks")).json()
    assert current["id"] in {row["id"] for row in links}
    body["expected_revision"] = source["revision"]
    body["document"]["content"][1]["attrs"]["parentId"] = notes[0]["id"]
    assert (await reader.put(base + f"/notes/{current['id']}", json=body)).status_code == 404


async def test_permissions_atomic_conflict_revoke_recycle_and_favorites(community):
    (owner, reader, other), names, p, notes, config = community
    pub = config["publication"]["id"]
    base = COMM + f"/publications/{pub}"
    r = await reader.get(base + "/permissions", params={"note_id": notes[2]["id"]})
    assert r.status_code == 200, r.text
    setting = {
        "note_id": notes[2]["id"],
        "expected_revision": 1,
        "visibility": "public",
        "members": [],
    }
    r = await reader.put(base + "/permissions", json={"articles": [setting]})
    assert r.status_code == 200, r.text
    assert (await other.get(base + f"/notes/{notes[2]['id']}")).status_code == 200
    # Removing one's own grant revokes management; source manager remains a recovery path.
    assert (
        await reader.put(base + "/permissions", json={"articles": [setting]})
    ).status_code == 404
    assert (await owner.put(base + "/permissions", json={"articles": [setting]})).status_code == 409
    assert (
        await other.put(COMM + f"/favorites/community/{pub}", json={"favorite": True})
    ).status_code == 200
    assert f"community/{pub}" in (await other.get(COMM + "/favorites")).json()["resource_ids"]
    kp = (await owner.get(ROOT + f"/knowledge-bases/{p['id']}")).json()
    r = await owner.delete(
        ROOT + f"/notes/{notes[1]['id']}",
        params={
            "expected_revision": notes[1]["revision"],
            "expected_knowledge_revision": kp["revision"],
        },
    )
    assert r.status_code == 200, r.text
    trashed = r.json()
    kp = (await owner.get(ROOT + f"/knowledge-bases/{p['id']}")).json()
    r = await owner.post(
        ROOT + f"/notes/{notes[1]['id']}/restore",
        json={
            "expected_revision": trashed["revision"],
            "expected_knowledge_revision": kp["revision"],
        },
    )
    assert r.status_code == 200, r.text
    assert (await other.get(base + f"/notes/{notes[1]['id']}")).status_code == 404
    current = (await owner.get(COMM + f"/libraries/{p['id']}/publication")).json()
    body = {
        "expected_revision": current["publication"]["revision"],
        "title": "社区测试",
        "active": False,
        "articles": [{"note_id": notes[2]["id"], "expected_revision": 2, "visibility": "public"}],
    }
    assert (
        await owner.put(COMM + f"/libraries/{p['id']}/publication", json=body)
    ).status_code == 200
    assert (await other.get(base)).status_code == 404


async def test_scoped_upload_and_guessed_assets_and_links(community):
    (owner, reader, other), names, p, notes, config = community
    pub = config["publication"]["id"]
    base = COMM + f"/publications/{pub}"
    n = notes[1]
    secret = await owner.post(
        ROOT + "/attachments",
        files={"upload": ("secret.txt", io.BytesIO(b"private"), "text/plain")},
    )
    assert secret.status_code == 200, secret.text
    secret_id = secret.json()["asset_id"]
    assert (await other.get(base + f"/assets/{secret_id}/content")).status_code == 404
    r = await reader.post(
        base + f"/notes/{n['id']}/uploads",
        files={"upload": ("shared.txt", io.BytesIO(b"shared"), "text/plain")},
    )
    assert r.status_code == 200, r.text
    asset = r.json()
    document = doc("附件")
    document["content"].append(
        {
            "type": "attachment",
            "attrs": {
                "assetId": asset["asset_id"],
                "filename": asset["filename"],
                "mimeType": asset["mime_type"],
                "byteSize": asset["byte_size"],
            },
        }
    )
    body = {
        "expected_revision": n["revision"],
        "title": n["title"],
        "document": document,
        "tags": [],
    }
    assert (await other.get(base + f"/assets/{asset['asset_id']}/content")).status_code == 404
    saved = await reader.put(base + f"/notes/{n['id']}", json=body)
    assert saved.status_code == 200, saved.text
    assert (await other.get(base + f"/assets/{asset['asset_id']}/content")).content == b"shared"
    body["expected_revision"] = saved.json()["note"]["revision"]
    document["content"][-1]["attrs"]["assetId"] = secret_id
    assert (await reader.put(base + f"/notes/{n['id']}", json=body)).status_code == 404
    document = doc("引用")
    document["content"][0]["content"].append(
        {
            "type": "documentReference",
            "attrs": {"kind": "note", "noteId": notes[0]["id"], "label": "private"},
        }
    )
    body["document"] = document
    assert (await reader.put(base + f"/notes/{n['id']}", json=body)).status_code == 404
    # Browser Session requirement and CSRF remain enforced.
    reader.headers.pop("X-CSRF-Token")
    assert (await reader.put(base + f"/notes/{n['id']}", json=body)).status_code == 403


async def test_atomic_batch_authorization_and_source_management(community):
    (owner, reader, other), names, p, notes, config = community
    pub = config["publication"]["id"]
    base = COMM + f"/publications/{pub}"
    first = {
        "note_id": notes[2]["id"],
        "expected_revision": 1,
        "visibility": "public",
        "members": [],
    }
    denied = {
        "note_id": notes[1]["id"],
        "expected_revision": 1,
        "visibility": "members",
        "members": [],
    }
    assert (
        await reader.put(base + "/permissions", json={"articles": [first, denied]})
    ).status_code == 404
    assert (await other.get(base + f"/notes/{notes[2]['id']}")).status_code == 404
    invalid = {**denied, "members": [{"username": "missing-account", "role": "read"}]}
    assert (
        await owner.put(base + "/permissions", json={"articles": [first, invalid]})
    ).status_code == 422
    assert (await other.get(base + f"/notes/{notes[2]['id']}")).status_code == 404
    assert (await reader.get(base + "/management")).status_code == 404
    assert (await reader.get(COMM + f"/libraries/{p['id']}/publication")).status_code == 404
    foreign = (await other.post(ROOT + "/knowledge-bases", json={"title": "另一个空间"})).json()
    management = (await owner.get(base + "/management")).json()
    assert management["directory"]["knowledge_base"]["id"] == p["id"]
    body = {
        "expected_revision": management["config"]["publication"]["revision"],
        "title": "来源校验",
        "articles": [{"note_id": foreign["home_note_id"], "expected_revision": 0}],
    }
    assert (await owner.put(base + "/management", json=body)).status_code == 404
    assert (await owner.get(base + "/management")).json()["config"]["publication"]["revision"] == 1


async def test_browser_only_schema_and_permission_revocation(community):
    (owner, reader, other), names, p, notes, config = community
    pub = config["publication"]["id"]
    base = COMM + f"/publications/{pub}"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as anonymous:
        assert (await anonymous.get(base)).status_code == 401
    key = await owner.post(
        "/v1/account/api-keys",
        json={"name": "community-blocked", "scopes": ["studio:read"], "expires_in_days": 1},
    )
    assert key.status_code == 201, key.text
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": "Bearer " + key.json()["secret"]},
    ) as keyed:
        assert (await keyed.get(base)).status_code == 403
    body = {
        "title": "校验",
        "document": {"type": "invalid"},
        "expected_revision": notes[1]["revision"],
    }
    assert (await reader.put(base + f"/notes/{notes[1]['id']}", json=body)).status_code == 422
    body["document"] = doc("已撤销的编辑")
    assert (
        await owner.put(
            base + "/permissions",
            json={
                "articles": [
                    {
                        "note_id": notes[1]["id"],
                        "expected_revision": 1,
                        "members": [],
                        "visibility": "public",
                    }
                ]
            },
        )
    ).status_code == 200
    assert (await reader.put(base + f"/notes/{notes[1]['id']}", json=body)).status_code == 404
    current = (await reader.get(base + f"/notes/{notes[1]['id']}")).json()
    assert current["can_edit"] is False and current["can_manage"] is False
    assert current["note"]["parent_id"] is None
    assert (await owner.get(ROOT + f"/notes/{notes[1]['id']}")).json()["revision"] == notes[1][
        "revision"
    ]


async def test_explicit_article_grant_and_filtered_backlinks(community):
    (owner, reader, other), names, p, notes, config = community
    pub = config["publication"]["id"]
    base = COMM + f"/publications/{pub}"
    # A hidden source note refers to the readable child; its title must not appear in backlinks.
    private = notes[0]
    document = doc("隐藏的反向引用")
    document["content"][0]["content"].append(
        {
            "type": "documentReference",
            "attrs": {"kind": "note", "noteId": notes[1]["id"], "label": "公开子文档"},
        }
    )
    r = await owner.put(
        ROOT + f"/notes/{private['id']}",
        json={
            "title": private["title"],
            "knowledge_base_id": p["id"],
            "document": document,
            "expected_revision": private["revision"],
        },
    )
    assert r.status_code == 200, r.text
    assert (await other.get(base + f"/notes/{notes[1]['id']}/backlinks")).json() == []
    r = await owner.put(
        base + "/permissions",
        json={
            "articles": [
                {
                    "note_id": notes[2]["id"],
                    "expected_revision": 1,
                    "visibility": "members",
                    "members": [{"username": names[2], "role": "edit"}],
                }
            ]
        },
    )
    assert r.status_code == 200, r.text
    role = (await other.get(base + f"/notes/{notes[2]['id']}")).json()
    assert role["role"] == "edit" and role["can_edit"]
    assert (await other.get(base + "/management")).status_code == 404
    assert (await other.get(base + f"/notes/{private['id']}")).status_code == 404


async def test_library_recycle_and_restore_requires_explicit_republication(community):
    (owner, reader, other), names, p, notes, config = community
    pub = config["publication"]["id"]
    source = (await owner.get(ROOT + f"/knowledge-bases/{p['id']}")).json()
    r = await owner.delete(
        ROOT + f"/knowledge-bases/{p['id']}", params={"expected_revision": source["revision"]}
    )
    assert r.status_code == 200, r.text
    assert (await other.get(COMM + f"/publications/{pub}")).status_code == 404
    restored = await owner.post(
        ROOT + f"/knowledge-bases/{p['id']}/restore",
        json={"expected_revision": r.json()["revision"]},
    )
    assert restored.status_code == 200, restored.text
    assert (await other.get(COMM + f"/publications/{pub}")).status_code == 404
    settings = (await owner.get(COMM + f"/publications/{pub}/management")).json()["config"]
    assert settings["publication"]["active"] is False
    assert settings["articles"]


async def test_withdraw_library_after_every_published_article_is_recycled(community):
    (owner, _, other), _, project, notes, config = community
    pub = config["publication"]["id"]
    for note in notes[1:]:
        current_project = (await owner.get(ROOT + f"/knowledge-bases/{project['id']}")).json()
        removed = await owner.delete(
            ROOT + f"/notes/{note['id']}",
            params={
                "expected_revision": note["revision"],
                "expected_knowledge_revision": current_project["revision"],
            },
        )
        assert removed.status_code == 200, removed.text
    current = (await owner.get(COMM + f"/libraries/{project['id']}/publication")).json()
    assert current["articles"] == []
    withdrawn = await owner.put(
        COMM + f"/libraries/{project['id']}/publication",
        json={
            "expected_revision": current["publication"]["revision"],
            "title": "全部撤回",
            "active": False,
            "articles": [],
        },
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert not withdrawn.json()["publication"]["active"]
    assert (await other.get(COMM + f"/publications/{pub}")).status_code == 404


async def test_concurrent_community_and_source_saves_share_one_revision(community):
    import asyncio

    (owner, editor, _), _, _, notes, config = community
    note = notes[1]
    payload = {
        "expected_revision": note["revision"],
        "title": "并发社区修改",
        "document": doc("并发修改"),
        "tags": [],
    }
    source_payload = {
        **{
            k: note[k]
            for k in ["knowledge_base_id", "parent_id", "schema_version", "pinned", "favorite"]
        },
        **payload,
        "title": "并发原库修改",
    }
    results = await asyncio.gather(
        editor.put(
            COMM + f"/publications/{config['publication']['id']}/notes/{note['id']}", json=payload
        ),
        owner.put(ROOT + f"/notes/{note['id']}", json=source_payload),
    )
    assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
    saved = (await owner.get(ROOT + f"/notes/{note['id']}")).json()
    assert saved["revision"] == note["revision"] + 1
    assert saved["title"] in {"并发社区修改", "并发原库修改"}
