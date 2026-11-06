"""Table grants never inherit an embedding article's permissions."""

import pytest

from tests.apps.thought_workshop.test_knowledge_community import COMM, ROOT
from tests.apps.thought_workshop.test_knowledge_community import community as community

pytestmark = [pytest.mark.asyncio, pytest.mark.real_auth]


async def test_embedded_table_independent_permissions_attachments_and_revocation(community):
    (owner, reader, other), names, project, notes, config = community
    p = (await owner.get(ROOT + f"/knowledge-bases/{project['id']}")).json()
    response = await owner.post(
        ROOT + "/notes",
        json={
            "knowledge_base_id": p["id"],
            "expected_knowledge_revision": p["revision"],
            "title": "独立授权的表",
            "kind": "multitable",
        },
    )
    assert response.status_code == 200, response.text
    target = response.json()
    notes.append(target)
    source = ROOT + f"/notes/{target['id']}/multitable"
    t = (await owner.get(source)).json()["tables"][0]
    file = await owner.post(
        ROOT + "/attachments", files={"upload": ("table.txt", b"private table asset", "text/plain")}
    )
    assert file.status_code == 200, file.text
    asset = file.json()["asset_id"]
    t["fields"].extend(
        [
            {"id": "attachment-field", "name": "附件", "type": "attachment", "position": 4},
            {"id": "note-field", "name": "引用", "type": "note", "position": 5},
        ]
    )
    r = {
        "id": "community-record",
        "position": 0,
        "values": {
            t["fields"][0]["id"]: "可见任务",
            "attachment-field": [asset],
            "note-field": [notes[0]["id"]],
        },
    }
    saved = await owner.post(
        source + "/operations",
        json={
            "expected_revision": 0,
            "operations": [
                {"op": "table.put", "table": t},
                {"op": "records.put", "table_id": t["id"], "records": [r]},
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    parent = notes[1]
    ref = {
        "type": "multitableView",
        "attrs": {"noteId": target["id"], "tableId": t["id"], "viewId": t["views"][0]["id"]},
    }
    saved = await owner.put(
        ROOT + f"/notes/{parent['id']}",
        json={
            "title": parent["title"],
            "document": {"type": "doc", "content": [ref]},
            "knowledge_base_id": p["id"],
            "parent_id": parent["parent_id"],
            "expected_revision": parent["revision"],
        },
    )
    assert saved.status_code == 200, saved.text
    pub = config["publication"]["id"]
    table_base = COMM + f"/publications/{pub}/notes/{target['id']}/multitable"
    params = {"parent_note_id": parent["id"]}
    unavailable = await reader.get(table_base, params=params)
    assert unavailable.status_code == 404, unavailable.text
    permissions = await owner.put(
        COMM + f"/libraries/{p['id']}/publication",
        json={
            "expected_revision": config["publication"]["revision"],
            "title": "表格社区",
            "articles": [
                {
                    "note_id": target["id"],
                    "expected_revision": 0,
                    "visibility": "members",
                    "members": [{"username": names[1], "role": "edit"}],
                }
            ],
        },
    )
    assert permissions.status_code == 200, permissions.text
    assert (await reader.get(source)).status_code == 404
    structure = await reader.get(table_base, params=params)
    assert structure.status_code == 200 and structure.json()["role"] == "edit", structure.text
    assert (await other.get(table_base, params=params)).status_code == 404
    assert (
        await reader.get(table_base, params={"parent_note_id": notes[0]["id"]})
    ).status_code == 404
    asset_path = COMM + f"/publications/{pub}/assets/{asset}/content"
    assert (await reader.get(asset_path, params={"note_id": target["id"]})).status_code == 200
    assert (await other.get(asset_path, params={"note_id": target["id"]})).status_code == 404
    edit = {
        "expected_revision": 1,
        "operations": [{"op": "records.put", "table_id": t["id"], "records": [r]}],
    }
    assert (
        await reader.post(table_base + "/operations", params=params, json=edit)
    ).status_code == 200
    assert (
        await other.post(table_base + "/operations", params=params, json=edit)
    ).status_code == 404
    assert (await reader.get(table_base + "/history")).status_code == 404
    settings = (
        await owner.get(COMM + f"/publications/{pub}/permissions", params={"note_id": target["id"]})
    ).json()[0]
    revoked = await owner.put(
        COMM + f"/publications/{pub}/permissions",
        json={
            "articles": [
                {
                    "note_id": target["id"],
                    "expected_revision": settings["revision"],
                    "active": False,
                    "visibility": "members",
                    "members": [],
                }
            ]
        },
    )
    assert revoked.status_code == 200, revoked.text
    assert (await reader.get(table_base, params=params)).status_code == 404
    assert (await reader.get(asset_path, params={"note_id": target["id"]})).status_code == 404
    export = await reader.get(COMM + f"/publications/{pub}/export-snapshot")
    assert export.status_code == 200 and "可见任务" not in export.text
