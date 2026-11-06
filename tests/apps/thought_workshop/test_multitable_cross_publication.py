"""A readable embed resolves the target table's independent publication scope."""

import pytest

from tests.apps.thought_workshop.test_knowledge_community import COMM, ROOT
from tests.apps.thought_workshop.test_knowledge_community import community as community

pytestmark = [pytest.mark.asyncio, pytest.mark.real_auth]


async def test_cross_library_embed_and_static_export_recheck_target_grant(community):
    (owner, reader, _), names, _, notes, config = community
    library = (await owner.post(ROOT + "/knowledge-bases", json={"title": "独立源表"})).json()
    target = (
        await owner.post(
            ROOT + "/notes",
            json={
                "knowledge_base_id": library["id"],
                "expected_knowledge_revision": library["revision"],
                "title": "独立源表",
                "kind": "multitable",
            },
        )
    ).json()
    source = ROOT + f"/notes/{target['id']}/multitable"
    table = (await owner.get(source)).json()["tables"][0]
    result = await owner.post(
        source + "/operations",
        json={
            "expected_revision": 0,
            "operations": [
                {
                    "op": "records.put",
                    "table_id": table["id"],
                    "records": [
                        {
                            "id": "cross-library-row",
                            "position": 0,
                            "values": {table["fields"][0]["id"]: "跨库可读任务"},
                        }
                    ],
                }
            ],
        },
    )
    assert result.status_code == 200, result.text
    published = await owner.put(
        COMM + f"/libraries/{library['id']}/publication",
        json={
            "expected_revision": 0,
            "title": "独立表格发布",
            "articles": [
                {
                    "note_id": target["id"],
                    "expected_revision": 0,
                    "visibility": "members",
                    "members": [{"username": names[1], "role": "read"}],
                }
            ],
        },
    )
    assert published.status_code == 200, published.text
    target_publication = published.json()["publication"]["id"]
    parent = notes[1]
    response = await owner.put(
        ROOT + f"/notes/{parent['id']}",
        json={
            "title": parent["title"],
            "knowledge_base_id": parent["knowledge_base_id"],
            "parent_id": parent["parent_id"],
            "expected_revision": parent["revision"],
            "document": {
                "type": "doc",
                "content": [
                    {
                        "type": "multitableView",
                        "attrs": {
                            "noteId": target["id"],
                            "tableId": table["id"],
                            "viewId": table["views"][0]["id"],
                        },
                    }
                ],
            },
        },
    )
    assert response.status_code == 200, response.text
    publication = config["publication"]["id"]
    endpoint = COMM + f"/publications/{publication}/notes/{target['id']}/multitable"
    response = await reader.get(endpoint, params={"parent_note_id": parent["id"]})
    assert response.status_code == 200, response.text
    assert response.json()["publication_id"] == target_publication
    assert response.json()["role"] == "read"
    export = await reader.get(COMM + f"/publications/{publication}/export-snapshot")
    assert export.status_code == 200, export.text
    assert "跨库可读任务" in export.text
    assert target["id"] not in [n["id"] for n in export.json()["documents"]]
    revoked = await owner.put(
        COMM + f"/publications/{target_publication}/permissions",
        json={
            "articles": [
                {
                    "note_id": target["id"],
                    "expected_revision": 1,
                    "active": False,
                    "visibility": "members",
                    "members": [],
                }
            ],
        },
    )
    assert revoked.status_code == 200, revoked.text
    assert (await reader.get(endpoint, params={"parent_note_id": parent["id"]})).status_code == 404
    export = await reader.get(COMM + f"/publications/{publication}/export-snapshot")
    assert export.status_code == 200 and "跨库可读任务" not in export.text
