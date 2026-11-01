from app.apps.galgame_workshop.schemas import GalgameStoryDocumentOut, GalgameStoryDocumentPutIn
from app.apps.galgame_workshop.story.story import GalgameStoryDocuments
from app.runtime.entity_edits import edit, find
from app.runtime.operation_receipts import OperationError, record, replay
from app.runtime.revisions import RevisionConflictError


def clean_character_metadata(data):
    characters = data["characters"]
    used = set()
    for character in characters:
        for expression in character.get("expressions", []):
            used.add(expression.get("assetId"))
            for frame in (expression.get("sequence") or {}).get("frames", []):
                used.add(frame.get("assetId"))
        for skin in character.get("portraitSkins", []):
            used.update(item.get("assetId") for item in skin.get("overrides", []))
    data["assets"] = [
        asset
        for asset in data["assets"]
        if asset.get("type") != "image"
        or asset.get("role") != "characterPortrait"
        or asset["id"] in used
    ]
    identities = {character["id"] for character in characters}
    settings = data.get("settings", {})
    settings["characterStageOverrides"] = {
        key: value
        for key, value in settings.get("characterStageOverrides", {}).items()
        if key in identities
    }


def transform(current, body):
    data = current.document.model_dump(mode="json", by_alias=True)
    if set(body.settings) - {"synopsis", "entryChapterId"}:
        raise OperationError("settings 仅支持 synopsis 与 entryChapterId")
    data.update(body.settings)
    for op in body.operations:
        if op.entity == "fragment":
            items = find(data["chapters"], op.parent_id)["fragments"]
        elif op.entity == "block":
            chapters = (
                [find(data["chapters"], op.chapter_id)] if op.chapter_id else data["chapters"]
            )
            fragments = [f for c in chapters for f in c["fragments"]]
            matches = [f for f in fragments if f["id"] == op.parent_id]
            if len(matches) != 1:
                raise OperationError("Fragment 不存在或 ID 不唯一", "ambiguous_fragment")
            items = matches[0]["blocks"]
        else:
            items = data[op.entity + "s"]
        if op.action == "duplicate" and op.entity in {"chapter", "fragment"}:
            raise OperationError("复制章节或 Fragment 请显式提供重新映射 ID 后的 insert 内容")
        edit(items, op)
        if op.entity == "character" and (
            op.action == "remove" or {"expressions", "portraitSkins"}.intersection(op.value)
        ):
            clean_character_metadata(data)
    return GalgameStoryDocumentPutIn(document=data, expected_revision=body.expected_revision)


async def apply_operations(session, owner_user_id, project_id, body):
    documents = GalgameStoryDocuments(session)
    current = await documents.get(project_id)
    key = dict(owner_user_id=owner_user_id, kind="galgame", resource_id=project_id, body=body)
    saved = await replay(session, **key)
    if saved is not None:
        return GalgameStoryDocumentOut.model_validate(saved)
    if current.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision, current.revision, current.model_dump(mode="json")
        )
    candidate = transform(current, body)
    try:
        result = await documents.put(project_id, candidate, commit=False)
        record(session, **key, result=result)
        await session.commit()
        return result
    except RevisionConflictError:
        saved = await replay(session, **key)
        if saved is not None:
            return GalgameStoryDocumentOut.model_validate(saved)
        raise
    except Exception:
        await session.rollback()
        raise
