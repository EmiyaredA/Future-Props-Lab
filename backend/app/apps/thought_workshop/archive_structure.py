"""Pure archive ownership validation before any file or database persistence."""

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.schemas.document import empty_document, file_ids
from app.apps.thought_workshop.schemas.knowledge import KnowledgeBaseIn
from app.apps.thought_workshop.schemas.workshop import ThoughtNoteIn


def convert_v3_folders_to_notes(payload: dict) -> dict:
    """Upgrade v3 folder+note archives into nestable documents."""
    if payload.get("version") in {4, 5, 6, 7} and not payload.get("folders"):
        for note in payload.get("notes") or []:
            if "parent_id" not in note and "folder_id" in note:
                note["parent_id"] = note.pop("folder_id")
            else:
                note.pop("folder_id", None)
                note.setdefault("parent_id", None)
        return payload
    folders = payload.get("folders") or []
    notes = [dict(note) for note in payload.get("notes") or []]
    converted = []
    for folder in folders:
        converted.append(
            {
                "id": folder["id"],
                "knowledge_base_id": folder["knowledge_base_id"],
                "parent_id": folder.get("parent_id"),
                "position": folder.get("position", 0),
                "title": folder["title"],
                "is_home": False,
                "document": empty_document(),
                "schema_version": 2,
                "created_at": folder.get("created_at"),
                "updated_at": folder.get("updated_at"),
            }
        )
    for note in notes:
        if "parent_id" not in note and "folder_id" in note:
            note["parent_id"] = note.pop("folder_id")
        else:
            note.pop("folder_id", None)
            note.setdefault("parent_id", None)
        converted.append(note)
    return {
        **payload,
        "version": 4,
        "folders": [],
        "notes": converted,
    }


def validate_structure(payload: dict) -> list[ThoughtNoteIn]:
    groups = [payload.get(key, []) for key in ("knowledge_bases", "notes", "assets")]
    if any(not isinstance(group, list) or len(group) > 10000 for group in groups):
        raise ThoughtError("备份清单无效")
    if payload.get("folders"):
        raise ThoughtError("备份目录格式已过期")
    indexes = []
    for group in groups:
        index = {item["id"]: item for item in group}
        if len(index) != len(group) or any(not isinstance(key, str) or not key for key in index):
            raise ThoughtError("备份包含重复或无效标识")
        indexes.append(index)
    projects, documents, assets = indexes
    for project in projects.values():
        KnowledgeBaseIn(
            **{key: project[key] for key in KnowledgeBaseIn.model_fields if key in project}
        )
        home = documents.get(project["home_note_id"])
        if (
            not home
            or home["knowledge_base_id"] != project["id"]
            or not home.get("is_home")
            or home.get("parent_id")
            or home.get("deleted_at")
            or home.get("kind", "note") != "note"
        ):
            raise ThoughtError("知识库首页无效")
        if project.get("cover_asset_id") and project["cover_asset_id"] not in assets:
            raise ThoughtError("备份缺少封面")
    result = []
    for source in documents.values():
        body = ThoughtNoteIn(
            **{key: source[key] for key in ThoughtNoteIn.model_fields if key in source}
        )
        project = projects.get(body.knowledge_base_id)
        if not project or (
            bool(source.get("is_home")) != (source["id"] == project["home_note_id"])
        ):
            raise ThoughtError("文档归属或首页标记无效")
        if body.parent_id:
            parent = documents.get(body.parent_id)
            if (
                not parent
                or parent["knowledge_base_id"] != body.knowledge_base_id
                or parent.get("is_home")
            ):
                raise ThoughtError("文档父级归属无效")
            visited = {source["id"]}
            current = body.parent_id
            while current:
                if current in visited:
                    raise ThoughtError("备份目录循环或归属错误")
                visited.add(current)
                ancestor = documents.get(current)
                if not ancestor or ancestor["knowledge_base_id"] != body.knowledge_base_id:
                    raise ThoughtError("备份目录循环或归属错误")
                current = ancestor.get("parent_id")
        if not file_ids(body.document) <= assets.keys():
            raise ThoughtError("备份缺少引用文件")
        if not isinstance(source.get("position", 0), int) or source.get("position", 0) < 0:
            raise ThoughtError("排序位置无效")
        result.append(body)
    return result
