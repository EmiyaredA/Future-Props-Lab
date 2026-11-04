"""Archive preflight retains files present only in a historical snapshot."""

from app.apps.thought_workshop.archive_import import allocate_ids, archive_references
from app.apps.thought_workshop.schemas.document import empty_document
from app.apps.thought_workshop.schemas.workshop import ThoughtNoteIn


def image_document(asset_id):
    return {"type": "doc", "content": [{"type": "image", "attrs": {"assetId": asset_id}}]}


def test_archive_pins_include_history_cover_and_template_for_the_new_resource_ids():
    time = "2026-11-04T09:00:00"
    table = {
        "id": "table",
        "name": "Files",
        "fields": [
            {"id": "name", "name": "Name", "type": "text", "position": 0},
            {"id": "file", "name": "File", "type": "attachment", "position": 1},
        ],
        "views": [{"id": "view", "name": "Grid", "type": "grid", "position": 0}],
        "position": 0,
    }
    current = {"tables": [table], "records": {"table": []}}
    old = {
        "tables": [table],
        "records": {"table": [{"id": "row", "position": 0, "values": {"file": ["table-old"]}}]},
    }
    payload = {
        "knowledge_bases": [{"id": "library", "cover_asset_id": "cover"}],
        "notes": [
            {"id": "home", "is_home": True},
            {"id": "note", "deleted_at": time},
            {"id": "files"},
        ],
        "history": [
            {
                "id": "prior",
                "note_id": "note",
                "revision": 0,
                "title": "Prior",
                "document": image_document("note-old"),
                "tags": [],
                "source": "create",
                "author_name": "",
                "created_at": time,
            }
        ],
        "multitables": {
            "files": {
                "state": current,
                "history": [
                    {"checkpoint": old, "changes": []},
                    {"checkpoint": current, "changes": []},
                ],
            }
        },
        "templates": [
            {
                "id": "template",
                "name": "Template",
                "document": image_document("template-image"),
                "kind": "multitable",
                "multitable": old,
                "revision": 0,
                "created_at": time,
                "updated_at": time,
            }
        ],
    }
    parsed = [
        ThoughtNoteIn(knowledge_base_id="library", document=image_document("home-image")),
        ThoughtNoteIn(knowledge_base_id="library", document=empty_document()),
        ThoughtNoteIn(knowledge_base_id="library", kind="multitable", document=empty_document()),
    ]
    assets = {
        asset: f"new-{asset}"
        for asset in ("cover", "note-old", "table-old", "template-image", "home-image")
    }
    ids = allocate_ids(payload)
    assert archive_references(payload, parsed, ids, assets) == {
        ("knowledge-base", ids.projects["library"]): {"new-cover"},
        ("note", ids.notes["home"]): {"new-home-image"},
        ("note", ids.notes["note"]): {"new-note-old"},
        ("note", ids.notes["files"]): {"new-table-old"},
        ("template", ids.templates["template"]): {"new-template-image", "new-table-old"},
    }
    assert archive_references(payload, parsed, ids, assets, into_existing=True) == {
        ("note", ids.notes["note"]): {"new-note-old"},
        ("note", ids.notes["files"]): {"new-table-old"},
        ("template", ids.templates["template"]): {"new-template-image", "new-table-old"},
    }
