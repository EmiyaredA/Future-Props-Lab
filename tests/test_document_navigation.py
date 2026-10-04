"""Navigation blocks survive storage and copying without cached protected metadata."""

import pytest

from app.apps.thought_workshop.knowledge_tools.references import reference_ids, remap_references
from app.apps.thought_workshop.schemas.document import validate_document


def card(target="target"):
    return {
        "type": "documentCard",
        "attrs": {"kind": "note", "noteId": target, "style": "featured", "eyebrow": "从这里开始"},
    }


def test_navigation_validation_and_reference_projection():
    document = {
        "type": "doc",
        "content": [
            {"type": "cardGrid", "content": [card()]},
            {"type": "documentDirectory", "attrs": {"parentId": "parent", "style": "cards"}},
            {
                "type": "callout",
                "attrs": {"variant": "tip", "title": "先保存"},
                "content": [{"type": "paragraph"}],
            },
        ],
    }
    assert validate_document(document) == document
    assert reference_ids(document) == {"target", "parent"}
    copied = remap_references(document, {"target": "new-target", "parent": "new-parent"})
    assert reference_ids(copied) == {"new-target", "new-parent"}
    assert reference_ids(document) == {"target", "parent"}
    portable = remap_references(document, {}, portable=True)
    assert reference_ids(portable) == set()
    assert validate_document(portable) == portable


@pytest.mark.parametrize(
    "node",
    [
        {
            "type": "documentCard",
            "attrs": {"kind": "note", "noteId": "target", "title": "cached private title"},
        },
        {"type": "documentCard", "attrs": {"kind": "note", "noteId": "javascript:alert(1)"}},
        {
            "type": "documentCard",
            "attrs": {"kind": "official", "libraryId": "general", "documentId": "../private"},
        },
        {"type": "cardGrid", "content": [{"type": "paragraph"}]},
        {"type": "documentDirectory", "attrs": {"parentId": "../../private", "style": "cards"}},
        {"type": "documentDirectory", "attrs": {"parentId": None, "style": "html"}},
    ],
)
def test_navigation_rejects_uncontrolled_structure(node):
    with pytest.raises(ValueError):
        validate_document({"type": "doc", "content": [node]})


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_navigation_backup_history_and_search_use_original_note_contract():
    import httpx
    from tests.test_account_system import (
        create_test_account,
        login_and_change_password,
        unsafe_headers,
    )
    from tests.test_thought_knowledge_tools import ROOT, note, project, put

    from app.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await login_and_change_password(client, *(await create_test_account()))
        client.headers.update(unsafe_headers(client))
        library = await project(client, "通用编排")
        target = await note(client, library, "目标文档")
        child = await note(client, library, "子文档", parent=target["id"])
        document = {
            "type": "doc",
            "content": [
                {"type": "cardGrid", "content": [card(target["id"]), card(child["id"])]},
                {
                    "type": "documentDirectory",
                    "attrs": {"parentId": target["id"], "style": "cards"},
                },
                {
                    "type": "callout",
                    "attrs": {"variant": "tip", "title": "保存验证提示"},
                    "content": [{"type": "paragraph"}],
                },
            ],
        }
        home = (await client.get(ROOT + "/notes/" + library["home_note_id"])).json()
        home = await put(client, home, document=document)
        home = await put(client, home, title="自由编排首页")
        assert home["document"] == document
        history = (await client.get(ROOT + f"/notes/{home['id']}/history")).json()["items"]
        snapshot = (
            await client.get(ROOT + f"/notes/{home['id']}/history/{history[0]['id']}")
        ).json()
        assert snapshot["current"]["document"] == document
        result = (await client.get(ROOT + "/search", params={"query": "保存验证提示"})).json()
        assert home["id"] in {item["id"] for item in result["items"]}
        package = await client.get(ROOT + "/backup", params={"knowledge_base_id": library["id"]})
        imported = await client.post(
            ROOT + "/imports",
            files={"upload": ("navigation.zip", package.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        copies = [
            (await client.get(ROOT + "/notes/" + id)).json() for id in imported.json()["note_ids"]
        ]
        imported_library = (
            await client.get(ROOT + "/knowledge-bases/" + imported.json()["knowledge_base_ids"][0])
        ).json()
        copied_home = (await client.get(ROOT + "/notes/" + imported_library["home_note_id"])).json()
        by_title = {item["title"]: item for item in copies}
        remapped = {
            target["id"]: by_title[target["title"]]["id"],
            child["id"]: by_title[child["title"]]["id"],
        }
        assert copied_home["document"] == remap_references(document, remapped)
        copied_target = by_title[target["title"]]
        links = (await client.get(ROOT + f"/notes/{copied_target['id']}/backlinks")).json()
        assert copied_home["id"] in {item["id"] for item in links}
