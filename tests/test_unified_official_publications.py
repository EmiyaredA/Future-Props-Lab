"""Unified publication policy and recoverable import against isolated data."""

import asyncio
from contextlib import AsyncExitStack
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from tests.test_account_system import create_test_account, login_and_change_password, unsafe_headers
from tests.test_knowledge_community import COMM, ROOT
from tests.test_knowledge_community import community as community

from app.main import app
from studio.apps.thought_workshop.publication.access import effective_role

pytestmark = [pytest.mark.asyncio, pytest.mark.real_auth]


async def test_official_flag_is_not_a_user_tag_and_requires_platform_admin(community):
    (owner, _, _), _, project, notes, config = community
    payload = dict(
        expected_revision=config["publication"]["revision"],
        title="官方",
        is_official=True,
        articles=[dict(note_id=notes[1]["id"], expected_revision=1)],
    )
    response = await owner.put(COMM + f"/libraries/{project['id']}/publication", json=payload)
    assert response.status_code == 403
    payload.update(is_official=False, editable_platform_roles=["user"])
    assert (
        await owner.put(COMM + f"/libraries/{project['id']}/publication", json=payload)
    ).status_code == 403
    assert (await owner.get(COMM + "/official-import/preview")).status_code == 403
    unchanged = (await owner.get(COMM + f"/libraries/{project['id']}/publication")).json()
    assert unchanged["publication"]["revision"] == config["publication"]["revision"]


async def test_read_only_stops_implicit_source_edit_but_keeps_explicit_grants(community):
    (owner, reader, other), names, project, notes, config = community

    payload = dict(
        expected_revision=config["publication"]["revision"],
        title="只读默认",
        read_only=True,
        articles=[
            dict(
                note_id=notes[1]["id"],
                expected_revision=1,
                members=[dict(username=names[1], role="edit")],
            )
        ],
    )
    result = await owner.put(COMM + f"/libraries/{project['id']}/publication", json=payload)
    assert result.status_code == 200, result.text
    pub = result.json()["publication"]
    assert pub["read_only"] and not pub["is_official"]
    url = COMM + f"/publications/{pub['id']}/notes/{notes[1]['id']}"
    assert (await reader.get(url)).json()["can_edit"]
    assert not (await other.get(url)).json()["can_edit"]
    n = (await other.get(url)).json()["note"]
    body = dict(expected_revision=n["revision"], title="不可越权", document=n["document"])
    assert (await other.put(url, json=body)).status_code == 404
    assert (await owner.get(ROOT + f"/notes/{n['id']}")).status_code == 200
    permissions = COMM + f"/publications/{pub['id']}/permissions"
    r = await owner.put(
        permissions, json={"articles": [dict(note_id=n["id"], expected_revision=2, members=[])]}
    )
    assert r.status_code == 200, r.text
    assert (await reader.put(url, json=body)).status_code == 404


async def test_role_grants_never_open_hidden_articles_or_grant_management():
    p = SimpleNamespace(
        read_only=True,
        editable_platform_roles=["admin", "user"],
        publisher_id="owner",
        owner_user_id="owner",
    )
    u = SimpleNamespace(user_id="other", platform_role="user")
    assert effective_role(p, u, None, None, "members") is None
    assert effective_role(p, u, None, None, "public") == "edit"
    p.editable_platform_roles = []
    assert effective_role(p, u, "edit", None, "public") == "read"
    p.read_only = False
    assert effective_role(p, u, "edit", None, "members") == "edit"


@pytest.fixture
async def administrator():
    async with AsyncExitStack() as stack:
        username, password = await create_test_account(platform_admin=True)
        c = await stack.enter_async_context(
            httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        )
        await login_and_change_password(c, username, password)
        c.headers.update(unsafe_headers(c))
        yield c


async def test_import_replays_concurrent_requests_and_resolves_only_visible_published_notes(
    administrator,
):
    c = administrator
    preview = (await c.get(COMM + "/official-import/preview")).json()
    assert (
        preview["library_count"] == 12
        and preview["article_count"] == 93
        and preview["figure_count"] > 30
    )
    request = dict(request_id=str(uuid4()), package_version=preview["package_version"])
    a, b = await asyncio.gather(
        c.post(COMM + "/official-import", json=request),
        c.post(COMM + "/official-import", json=request),
    )
    assert a.status_code == b.status_code == 200, (a.text, b.text)
    imported = a.json()
    assert a.json() == b.json() and len(imported["note_ids"]) == preview["article_count"]
    assert len(imported["knowledge_base_ids"]) == 12
    assert (await c.get(COMM + "/official-import/" + request["request_id"])).json() == imported
    assert (
        await c.get(COMM + "/official-links/technical", params={"document_key": "scope"})
    ).json() == []
    dirs = [
        (await c.get(ROOT + f"/knowledge-bases/{id}/directory")).json()
        for id in imported["knowledge_base_ids"]
    ]
    technical = next(d for d in dirs if d["knowledge_base"]["title"] == "Future Props Lab 技术文档")
    docs = technical["documents"]
    first = docs[0]
    note = (await c.get(ROOT + f"/notes/{first['id']}")).json()
    assert (
        note["document"]["content"][0]["type"] != "heading"
        or note["document"]["content"][0]["attrs"]["level"] != 1
    )
    assert "fpl-canvas" not in str(note["document"]) and "official-knowledge-bases" not in str(
        note["document"]
    )
    body = dict(
        expected_revision=0,
        title="管理员官方指南",
        is_official=True,
        read_only=True,
        editable_platform_roles=["admin", "admin"],
        articles=[dict(note_id=n["id"], expected_revision=0) for n in docs]
        + [dict(note_id=technical["knowledge_base"]["home_note_id"], expected_revision=0)],
    )
    response = await c.put(
        COMM + f"/libraries/{technical['knowledge_base']['id']}/publication", json=body
    )
    assert response.status_code == 200, response.text
    pub = response.json()["publication"]
    assert pub["is_official"] and pub["read_only"] and pub["can_set_official"]
    resolved = (
        await c.get(COMM + "/official-links/technical", params={"document_key": "scope"})
    ).json()
    assert len(resolved) == 1 and resolved[0]["publication"]["id"] == pub["id"]
    assert (
        await c.get(COMM + "/publications", params={"official": True, "query": "管理员官方指南"})
    ).json()[0]["id"] == pub["id"]
    assert (
        await c.put(COMM + "/favorites/official/technical", json={"favorite": True})
    ).status_code == 200
    favorites = (await c.get(COMM + "/publications", params={"favorites": True})).json()
    assert any(p["id"] == pub["id"] and p["favorite"] for p in favorites)
    assert (
        await c.put(COMM + f"/favorites/community/{pub['id']}", json={"favorite": False})
    ).status_code == 200
    assert "official/technical" not in (await c.get(COMM + "/favorites")).json()["resource_ids"]
    body.update(expected_revision=1, is_official=False, articles=[], active=False)
    assert (
        await c.put(COMM + f"/libraries/{technical['knowledge_base']['id']}/publication", json=body)
    ).status_code == 200
    assert (
        await c.get(COMM + "/official-links/technical", params={"document_key": "scope"})
    ).json() == []


async def test_import_failure_rolls_back_content_mapping_and_receipt(administrator, monkeypatch):
    from studio.apps.thought_workshop.publication import imports

    c = administrator
    before = (await c.get(ROOT + "/knowledge-bases")).json()
    version = (await c.get(COMM + "/official-import/preview")).json()["package_version"]
    request = dict(request_id=str(uuid4()), package_version=version)

    def fail_mapping(**_values):
        raise RuntimeError("mapping failure")

    with monkeypatch.context() as patch:
        patch.setattr(imports, "OfficialSource", fail_mapping)
        with pytest.raises(RuntimeError, match="mapping failure"):
            await c.post(COMM + "/official-import", json=request)
    assert (await c.get(ROOT + "/knowledge-bases")).json() == before
    assert (await c.get(COMM + "/official-import/" + request["request_id"])).status_code == 404
    complete = await c.post(COMM + "/official-import", json=request)
    assert complete.status_code == 200, complete.text
    assert len(complete.json()["knowledge_base_ids"]) == 12
    request["package_version"] = "0" * 64
    assert (await c.post(COMM + "/official-import", json=request)).status_code == 409


async def test_role_editing_is_separate_from_management_and_revocation_blocks_writes(administrator):
    owner = administrator
    created = (
        await owner.post(
            "/v1/platform/accounts",
            json={
                "username": "official-editor-" + uuid4().hex[:12],
                "platform_role": "admin",
            },
        )
    ).json()
    account = created["account"]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as editor:
        await login_and_change_password(editor, account["username"], created["temporary_password"])
        editor.headers.update(unsafe_headers(editor))
        library = (await owner.post(ROOT + "/knowledge-bases", json={"title": "角色授权"})).json()
        note = (
            await owner.post(
                ROOT + "/notes",
                json={
                    "knowledge_base_id": library["id"],
                    "expected_knowledge_revision": library["revision"],
                    "title": "可见文章",
                    "document": {"type": "doc", "content": [{"type": "paragraph"}]},
                },
            )
        ).json()
        hidden = (
            await owner.post(
                ROOT + "/notes",
                json={
                    "knowledge_base_id": library["id"],
                    "expected_knowledge_revision": library["revision"] + 1,
                    "title": "限定文章",
                },
            )
        ).json()
        settings = dict(
            expected_revision=0,
            title="官方角色权限",
            is_official=True,
            editable_platform_roles=["admin"],
            articles=[
                dict(note_id=note["id"], expected_revision=0),
                dict(note_id=hidden["id"], expected_revision=0, visibility="members"),
            ],
        )
        response = await owner.put(COMM + f"/libraries/{library['id']}/publication", json=settings)
        assert response.status_code == 200, response.text
        pub = response.json()["publication"]
        url = COMM + f"/publications/{pub['id']}/notes/{note['id']}"
        visible = await editor.get(url)
        assert visible.status_code == 200, visible.text
        assert visible.json()["can_edit"] and not visible.json()["can_manage"]
        assert (
            await editor.get(COMM + f"/publications/{pub['id']}/notes/{hidden['id']}")
        ).status_code == 404
        body = dict(expected_revision=0, title="管理员已编辑", document=note["document"])
        saved = await editor.put(url, json=body)
        assert saved.status_code == 200, saved.text
        assert (await editor.put(url, json=body)).status_code == 409
        changed = await owner.patch(
            "/v1/platform/accounts/" + account["id"],
            json={
                "expected_revision": (await editor.get("/v1/auth/me")).json()["user"]["revision"],
                "platform_role": "user",
            },
        )
        assert changed.status_code == 200, changed.text
        body["expected_revision"] = 1
        denied = await editor.put(url, json=body)
        assert denied.status_code in {401, 404}


async def test_cross_library_references_hide_unpublished_and_unauthorized_targets(community):
    (owner, reader, _), _, _, _, config = community
    project = (await owner.post(ROOT + "/knowledge-bases", json={"title": "引用目标"})).json()
    note = (
        await owner.post(
            ROOT + "/notes",
            json={
                "knowledge_base_id": project["id"],
                "expected_knowledge_revision": project["revision"],
                "title": "私人目标",
            },
        )
    ).json()
    endpoint = COMM + f"/publications/{config['publication']['id']}/references"
    assert (await reader.post(endpoint, json={"ids": [note["id"]]})).json() == [
        dict(
            id=note["id"],
            available=False,
            title="",
            knowledge_base_id=None,
            publication_id=None,
            excerpt="",
            revision=None,
        )
    ]
    published = await owner.put(
        COMM + f"/libraries/{project['id']}/publication",
        json={
            "expected_revision": 0,
            "title": "跨库发布",
            "articles": [dict(note_id=note["id"], expected_revision=0)],
        },
    )
    assert published.status_code == 200, published.text
    resolved = (await reader.post(endpoint, json={"ids": [note["id"]]})).json()[0]
    assert (
        resolved["available"]
        and resolved["publication_id"] == published.json()["publication"]["id"]
    )


async def test_read_only_table_and_uploads_share_effective_article_permissions(community):
    (owner, reader, other), names, project, notes, config = community

    current = (await owner.get(ROOT + f"/knowledge-bases/{project['id']}")).json()
    table_note = (
        await owner.post(
            ROOT + "/notes",
            json={
                "title": "只读源表",
                "kind": "multitable",
                "knowledge_base_id": project["id"],
                "expected_knowledge_revision": current["revision"],
            },
        )
    ).json()
    table = (await owner.get(ROOT + f"/notes/{table_note['id']}/multitable")).json()["tables"][0]
    response = await owner.put(
        COMM + f"/libraries/{project['id']}/publication",
        json={
            "expected_revision": 1,
            "title": "只读表格",
            "read_only": True,
            "articles": [
                dict(
                    note_id=table_note["id"],
                    expected_revision=0,
                    members=[dict(username=names[1], role="edit")],
                )
            ],
        },
    )
    assert response.status_code == 200, response.text
    pub = response.json()["publication"]
    endpoint = COMM + f"/publications/{pub['id']}/notes/{table_note['id']}/multitable"
    operations = dict(
        expected_revision=0,
        operations=[
            dict(
                op="records.put",
                table_id=table["id"],
                records=[dict(id="row", position=0, values={table["fields"][0]["id"]: "完成"})],
            )
        ],
    )
    assert (await other.get(endpoint)).json()["role"] == "read"
    assert (await other.post(endpoint + "/operations", json=operations)).status_code == 404
    edited = await reader.post(endpoint + "/operations", json=operations)
    assert edited.status_code == 200, edited.text
    upload = COMM + f"/publications/{pub['id']}/notes/{notes[1]['id']}/uploads"
    assert (
        await other.post(upload, files={"upload": ("note.txt", b"private", "text/plain")})
    ).status_code == 404
    # Explicit editor writes succeed; revoked account grants cannot reuse a prior batch.
    assert (
        await owner.put(
            COMM + f"/publications/{pub['id']}/permissions",
            json={
                "articles": [dict(note_id=table_note["id"], expected_revision=1, members=[])],
            },
        )
    ).status_code == 200
    operations["expected_revision"] = 1
    assert (await reader.post(endpoint + "/operations", json=operations)).status_code == 404
