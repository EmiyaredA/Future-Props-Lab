"""Apply transcript edits and matched voice references in their owned transactions."""

import re

from pydantic import ValidationError

from studio.apps.galgame_workshop.assets.transcript_records import write_transcript
from studio.apps.galgame_workshop.assets.voice_matching import match_dialogue
from studio.apps.galgame_workshop.schemas import GalgameStoryDocumentPutIn, GalgameVoiceMatchOut
from studio.contracts.asset_library.descriptions import ID
from studio.contracts.asset_library.errors import AssetError

from .story_writes import story_error


async def patch_transcript(files, project_id, asset_id, body):
    await files.projects.row(project_id)
    if not re.fullmatch(ID, asset_id):
        raise AssetError("语音素材不存在", code="not_found", status=404)
    records = await files.asset_records(
        project_id, (), newest_first=False, project_file_id=asset_id
    )
    if not records:
        raise AssetError("语音素材不存在", code="not_found", status=404)
    asset, metadata = records[0]
    if metadata is None or asset.media_kind != "audio":
        raise AssetError("语音素材不存在", code="not_found", status=404)
    return await write_transcript(files.session, metadata, asset_id, body)


async def match_voice(files, writes, project_id, body):
    story = await writes.current_story(project_id, body.expected_story_revision)
    records = await files.asset_records(project_id, (), newest_first=False)
    requested = None if body.asset_ids is None else set(body.asset_ids)
    voices = [
        (asset, metadata)
        for asset, metadata in records
        if metadata is not None
        and metadata.category == "voice"
        and metadata.transcript_status == "ready"
        and (requested is None or asset.id in requested)
    ]
    voices.sort(key=lambda pair: pair[0].display_name)
    payload, matches, unmatched = match_dialogue(story.document, voices, body)
    try:
        candidate = GalgameStoryDocumentPutIn.model_validate(
            {"expected_revision": body.expected_story_revision, "document": payload}
        )
    except ValidationError as exc:
        raise story_error("匹配结果违反故事规则") from exc
    saved = await writes.save_voice_matches(project_id, candidate)
    return GalgameVoiceMatchOut(
        storyRevision=saved.revision, matches=matches, unmatchedAssetIds=unmatched
    )
