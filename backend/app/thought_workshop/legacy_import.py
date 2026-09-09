"""The only runtime adapter for v1/v2 notebook backups. Never used for normal writes."""

from uuid import uuid4

from app.schemas.thought_document import empty_document


def convert_legacy_backup(payload: dict) -> dict:
    if payload.get("version") not in {1, 2}:
        return payload
    project_id, home_id = str(uuid4()), str(uuid4())
    folders = [
        {
            "id": book["id"],
            "title": book["title"],
            "knowledge_base_id": project_id,
            "parent_id": None,
            "position": i,
        }
        for i, book in enumerate(payload.get("notebooks", []))
    ]
    documents = []
    for i, source in enumerate(payload.get("notes", [])):
        note = dict(source)
        note.setdefault("id", str(uuid4()))
        note.update(
            knowledge_base_id=project_id,
            folder_id=note.pop("notebook_id", None),
            position=i,
            is_home=False,
            schema_version=2,
        )
        documents.append(note)
    documents.append(
        {
            "id": home_id,
            "knowledge_base_id": project_id,
            "title": "首页",
            "is_home": True,
            "document": empty_document(),
            "schema_version": 2,
        }
    )
    return {
        "format": payload["format"],
        "version": 3,
        "assets": payload.get("assets", []),
        "knowledge_bases": [{"id": project_id, "title": "导入的知识库", "home_note_id": home_id}],
        "folders": folders,
        "notes": documents,
    }
