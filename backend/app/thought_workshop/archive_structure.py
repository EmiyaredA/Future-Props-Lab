"""Pure archive ownership validation before any file or database persistence."""

from app.schemas.thought_document import file_ids
from app.schemas.thought_knowledge import KnowledgeBaseIn
from app.schemas.thought_workshop import ThoughtNoteIn
from app.thought_workshop.errors import ThoughtError


def validate_structure(payload: dict) -> list[ThoughtNoteIn]:
    groups = [payload.get(key, []) for key in ("knowledge_bases", "folders", "notes", "assets")]
    if any(not isinstance(group, list) or len(group) > 10000 for group in groups):
        raise ThoughtError("备份清单无效")
    indexes = []
    for group in groups:
        index = {item["id"]: item for item in group}
        if len(index) != len(group) or any(not isinstance(key, str) or not key for key in index):
            raise ThoughtError("备份包含重复或无效标识")
        indexes.append(index)
    projects, folders, documents, assets = indexes
    for project in projects.values():
        KnowledgeBaseIn(
            **{key: project[key] for key in KnowledgeBaseIn.model_fields if key in project}
        )
        home = documents.get(project["home_note_id"])
        if (
            not home
            or home["knowledge_base_id"] != project["id"]
            or not home.get("is_home")
            or home.get("folder_id")
            or home.get("deleted_at")
        ):
            raise ThoughtError("知识库首页无效")
        if project.get("cover_asset_id") and project["cover_asset_id"] not in assets:
            raise ThoughtError("备份缺少封面")
    for folder in folders.values():
        if (
            folder["knowledge_base_id"] not in projects
            or not str(folder["title"]).strip()
            or len(folder["title"]) > 120
        ):
            raise ThoughtError("文件夹归属或名称无效")
        if not isinstance(folder.get("position", 0), int) or folder.get("position", 0) < 0:
            raise ThoughtError("文件夹排序位置无效")
        visited = {folder["id"]}
        parent = folder.get("parent_id")
        while parent:
            ancestor = folders.get(parent)
            if (
                parent in visited
                or not ancestor
                or ancestor["knowledge_base_id"] != folder["knowledge_base_id"]
            ):
                raise ThoughtError("备份目录循环或归属错误")
            visited.add(parent)
            parent = ancestor.get("parent_id")
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
        if body.folder_id and (
            body.folder_id not in folders
            or folders[body.folder_id]["knowledge_base_id"] != body.knowledge_base_id
        ):
            raise ThoughtError("文档文件夹归属无效")
        if not file_ids(body.document) <= assets.keys():
            raise ThoughtError("备份缺少引用文件")
        if not isinstance(source.get("position", 0), int) or source.get("position", 0) < 0:
            raise ThoughtError("排序位置无效")
        result.append(body)
    return result
