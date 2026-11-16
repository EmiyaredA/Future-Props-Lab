"""Apply one timeline command without depending on SQL or an HTTP request."""

from typing import Protocol

from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.rules.timeline_operations import apply_operations, find_clip
from studio.apps.video_editor.rules.timeline_validation import (
    timeline_asset_ids,
    validate_asset_facts,
    validate_timeline,
)
from studio.apps.video_editor.schemas import VideoEditorTimelineBatchIn, VideoEditorTimelineOut
from studio.apps.video_editor.timeline_assets import TimelineAsset
from studio.runtime.revisions import RevisionConflictError


class TimelineAssets(Protocol):
    async def describe(self, project: str, ids: set[str]) -> dict[str, TimelineAsset]: ...
    async def guard_write(self, project: str) -> None: ...


class TimelineEdits(Protocol):
    """Owner-bound atomic CAS and receipt storage.

    Replay confirms the original command but returns the current snapshot. A
    later revision is not the result revision recorded for that command.
    """

    async def get(self, project: str) -> VideoEditorTimelineOut: ...
    async def replay(
        self, project: str, command: VideoEditorTimelineBatchIn
    ) -> VideoEditorTimelineOut | None: ...
    async def contexts(
        self, project: str, command: VideoEditorTimelineBatchIn, assets: TimelineAssets
    ) -> dict: ...
    async def commit(
        self, project: str, command: VideoEditorTimelineBatchIn, document: dict
    ) -> VideoEditorTimelineOut: ...


class EditTimeline:
    def __init__(self, store: TimelineEdits, assets: TimelineAssets):
        self.store, self.assets = store, assets

    async def execute(self, project: str, command: VideoEditorTimelineBatchIn):
        current = await self.store.get(project)
        replay = await self.store.replay(project, command)
        if replay is not None:
            return replay
        if current.revision != command.expected_revision:
            raise RevisionConflictError(
                command.expected_revision,
                current.revision,
                current.model_dump(mode="json", by_alias=True),
            )
        contexts = await self.store.contexts(project, command, self.assets)
        source = current.document.model_dump(mode="json", by_alias=True, exclude_none=True)
        candidate = validate_timeline(apply_operations(source, command, contexts))
        identities = timeline_asset_ids(candidate)
        facts = await self.assets.describe(project, identities) if identities else {}
        document = validate_asset_facts(candidate, facts)
        audio_ids = {
            find_clip(document, operation.to_clip_id)[1]["assetId"]
            for operation in command.operations
            if operation.type == "alignAudioSeam"
        }
        if audio_ids:
            records = await self.assets.describe(project, audio_ids)
            if set(records) != audio_ids or any(
                record.kind != "audio" or record.processing_status != "ready"
                for record in records.values()
            ):
                raise VideoEditorValidationError("音频素材尚未准备好", code="audio_not_ready")
        await self.assets.guard_write(project)
        return await self.store.commit(project, command, document)
