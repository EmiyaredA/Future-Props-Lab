"""Restore a Story file reference through the project owner and Assets."""

import re

from app.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.apps.galgame_workshop.story.asset_repair import replace_story_file
from app.apps.galgame_workshop.story.document_values import normalize_story_document
from app.capabilities.asset_store.errors import AssetError
from fpl_runtime.library_assets import ID

from .story_writes import story_error


async def repair_asset(files, writes, project_id, body):
    story = await writes.current_story(project_id, body.expected_story_revision)
    if not re.fullmatch(ID, body.replacement_file_id):
        raise AssetError("替换文件不存在或不属于当前工程", code="not_found", status=404)
    records = await files.asset_records(
        project_id,
        (),
        newest_first=False,
        project_file_id=body.replacement_file_id,
        replacement=True,
    )
    if not records:
        raise AssetError("替换文件不存在或不属于当前工程", code="not_found", status=404)
    replacement, _ = records[0]
    payload = replace_story_file(story.document, body.story_asset_id, replacement)
    try:
        document = normalize_story_document(payload)
    except GalgameStoryDocumentInvalidError as exc:
        raise story_error(str(exc)) from exc
    return await writes.repair_asset(project_id, body, document)
