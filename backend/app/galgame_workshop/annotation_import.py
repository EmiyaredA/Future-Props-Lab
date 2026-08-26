from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.time import iso_utc
from app.files import AssetError
from app.files.digests import sha256_file
from app.files.storage import AssetStorage
from app.galgame_workshop.story import GalgameStoryDocuments
from app.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    GalgameAnnotationImportTask,
    GalgameAssetMetadata,
    GalgameWorkshopProject,
    VisualAsset,
)
from app.schemas.audio_annotation import AudioAnnotationSegment, AudioAnnotationSpeaker
from app.schemas.galgame_workshop import (
    GalgameAnnotationImportIn,
    GalgameAnnotationImportIssue,
    GalgameAnnotationImportPreviewOut,
    GalgameAnnotationImportSegmentOut,
    GalgameAnnotationImportTaskOut,
    GalgameStoryDialogueBlock,
)


def _task_out(row: GalgameAnnotationImportTask) -> GalgameAnnotationImportTaskOut:
    result = dict(row.result_detail or {})
    phase = result.get("phase")
    allowed_phases = {
        "queued",
        "cutting",
        "validating",
        "saving",
        "accepting",
        "rolling_back",
        "completed",
        "failed",
        "conflict",
        "rolled_back",
    }
    if phase not in allowed_phases:
        phase = "cutting" if row.status == "running" else row.status
    return GalgameAnnotationImportTaskOut(
        id=row.id,
        projectId=row.project_id,
        sourceProjectId=row.source_project_id,
        requestId=row.request_id,
        status=row.status,
        phase=phase,
        progress=row.progress,
        result=result,
        error=row.error,
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        updatedAt=iso_utc(row.updated_at),
        startedAt=iso_utc(row.started_at) if row.started_at else None,
        finishedAt=iso_utc(row.finished_at) if row.finished_at else None,
    )


def _effective_text(segment: AudioAnnotationSegment) -> str:
    localized = next(
        (
            item.text.strip()
            for item in segment.localized_texts
            if item.language == "zh" and item.text.strip()
        ),
        "",
    )
    if localized:
        return localized
    if segment.language in {None, "zh"}:
        return segment.text.strip()
    return ""


def _curtain_intervals(segments: list[AudioAnnotationSegment], duration_ms: int) -> list[dict]:
    intervals: list[dict] = []
    if segments and segments[0].start_ms >= 500:
        intervals.append({"kind": "opening", "startMs": 0, "endMs": segments[0].start_ms})
    for left, right in zip(segments, segments[1:], strict=False):
        if right.start_ms - left.end_ms >= 500:
            intervals.append({"kind": "internal", "startMs": left.end_ms, "endMs": right.start_ms})
    if segments and duration_ms - segments[-1].end_ms >= 500:
        intervals.append({"kind": "ending", "startMs": segments[-1].end_ms, "endMs": duration_ms})
    return intervals


class GalgameAnnotationImports:
    def __init__(self, session: AsyncSession, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

    async def _target(self, project_id: str) -> GalgameWorkshopProject:
        row = await self.session.get(GalgameWorkshopProject, project_id)
        if row is None:
            raise AssetError("Galgame 项目不存在", code="not_found", status=404)
        return row

    async def preview(
        self, project_id: str, body: GalgameAnnotationImportIn
    ) -> GalgameAnnotationImportPreviewOut:
        await self._target(project_id)
        story = await GalgameStoryDocuments(self.session).get(project_id)
        source = await self.session.get(AudioAnnotationProject, body.source_project_id)
        document_row = await self.session.get(AudioAnnotationDocument, body.source_project_id)
        if source is None or document_row is None:
            raise AssetError("广播剧标注项目不存在", code="not_found", status=404)
        source_asset = await self.session.get(VisualAsset, source.asset_id)
        if source_asset is None or source_asset.media_kind != "audio":
            raise AssetError("广播剧源音频不可用", code="source_audio_missing", status=404)
        source_path = self.storage.path_for(source_asset)
        if not source_path.is_file():
            raise AssetError("广播剧源音频文件不存在", code="source_audio_missing", status=404)

        speakers = [AudioAnnotationSpeaker.model_validate(item) for item in document_row.speakers]
        segments = [AudioAnnotationSegment.model_validate(item) for item in document_row.segments]
        source_checksum = await asyncio.to_thread(sha256_file, source_path)
        issues: list[GalgameAnnotationImportIssue] = []

        def issue(code: str, message: str, path: str = "") -> None:
            issues.append(GalgameAnnotationImportIssue(code=code, message=message, path=path))

        if document_row.revision != body.expected_source_revision:
            issue(
                "source_revision_conflict",
                (
                    f"标注文档 revision 已从 {body.expected_source_revision} "
                    f"变为 {document_row.revision}"
                ),
                "/expectedSourceRevision",
            )
        if story.revision != body.expected_story_revision:
            issue(
                "story_revision_conflict",
                f"Story revision 已从 {body.expected_story_revision} 变为 {story.revision}",
                "/expectedStoryRevision",
            )

        requirements = body.requirements
        if len(segments) != requirements.segment_count:
            issue(
                "segment_count_mismatch", "标注片段数量不符合导入要求", "/requirements/segmentCount"
            )
        if len(speakers) != requirements.speaker_count:
            issue(
                "speaker_count_mismatch",
                "标注说话人数量不符合导入要求",
                "/requirements/speakerCount",
            )
        if source.duration_ms != requirements.timeline_duration_ms:
            issue(
                "timeline_duration_mismatch",
                "源音频时长不符合导入要求",
                "/requirements/timelineDurationMs",
            )
        if source_checksum != requirements.source_checksum_sha256:
            issue(
                "source_checksum_mismatch",
                "源音频校验和不符合导入要求",
                "/requirements/sourceChecksumSha256",
            )
        if segments and segments[-1].end_ms != requirements.last_dialogue_end_ms:
            issue(
                "last_dialogue_mismatch",
                "末句结束时间不符合导入要求",
                "/requirements/lastDialogueEndMs",
            )
        if set(body.speaker_map) != {speaker.id for speaker in speakers}:
            issue("speaker_map_mismatch", "说话人映射必须完整且不能包含未知说话人", "/speakerMap")

        segments_by_id = {segment.id: segment for segment in segments}
        for segment_id, speaker_ids in body.segment_speaker_overrides.items():
            segment = segments_by_id.get(segment_id)
            if segment is None:
                issue(
                    "unknown_speaker_override_segment",
                    "片段说话人覆盖引用了不存在的 segmentId",
                    "/segmentSpeakerOverrides",
                )
            elif segment.speaker_ids:
                issue(
                    "annotated_speaker_override",
                    "已有标注说话人的片段不能被导入配置覆盖",
                    f"/segmentSpeakerOverrides/{segment_id}",
                )
            elif any(speaker_id not in body.speaker_map for speaker_id in speaker_ids):
                issue(
                    "unknown_speaker_override",
                    "片段说话人覆盖引用了未知说话人",
                    f"/segmentSpeakerOverrides/{segment_id}",
                )

        previous_end = 0
        for index, segment in enumerate(segments):
            if not _effective_text(segment):
                issue("missing_chinese_text", "片段缺少中文对白", f"/segments/{index}")
            if segment.start_ms < previous_end:
                issue("overlapping_segments", "标注片段存在重叠", f"/segments/{index}")
            previous_end = segment.end_ms
            if not segment.speaker_ids and segment.id not in body.segment_speaker_overrides:
                issue(
                    "missing_segment_speaker",
                    "片段没有标注说话人，必须提供显式覆盖",
                    f"/segments/{index}",
                )

        fragments = [
            fragment for chapter in body.document.chapters for fragment in chapter.fragments
        ]
        fragment = fragments[0] if len(fragments) == 1 else None
        if fragment is None:
            issue(
                "fragment_count_mismatch", "导入 Story 必须只有一个 Fragment", "/document/chapters"
            )
        elif fragment.timeline is None or fragment.timeline.duration_ms != source.duration_ms:
            issue(
                "story_timeline_mismatch",
                "Story 时间轴必须与完整源音频等长",
                "/document/chapters/0/fragments/0/timeline",
            )

        voice_assets = [
            asset
            for asset in body.document.assets
            if asset.type == "audio" and asset.role == "voiceLine"
        ]
        masters = [
            asset
            for asset in body.document.assets
            if asset.type == "audio" and asset.role == "timelineMaster"
        ]
        if len(masters) != 1 or masters[0].file_id != body.master_asset_id:
            issue(
                "master_audio_mismatch",
                "时间轴主音轨必须引用请求指定的完整广播剧音频",
                "/document/assets",
            )
        elif fragment and (
            fragment.timeline is None
            or fragment.timeline.master_audio is None
            or fragment.timeline.master_audio.asset_id != masters[0].id
        ):
            issue(
                "master_audio_timeline_mismatch",
                "Fragment 未引用完整主音轨",
                "/document/chapters/0/fragments/0/timeline/masterAudio",
            )
        master_asset = await self.session.get(VisualAsset, body.master_asset_id)
        source_metadata = await self.session.get(GalgameAssetMetadata, body.master_asset_id)
        if (
            master_asset is None
            or master_asset.media_kind != "audio"
            or master_asset.galgame_project_id not in {None, project_id}
            or source_metadata is None
            or source_metadata.project_id != project_id
            or source_metadata.duration_ms != source.duration_ms
            or source_metadata.checksum_sha256 != source_checksum
        ):
            issue(
                "master_audio_metadata_mismatch",
                "完整源音频必须具有当前 Galgame 项目可用的准确素材元数据",
                "/document/assets",
            )

        segment_ids = {segment.id for segment in segments}
        if (
            len(voice_assets) != len(segments)
            or {asset.file_id for asset in voice_assets} != segment_ids
        ):
            issue(
                "voice_placeholder_mismatch",
                "每个标注 segmentId 必须对应一个唯一 voiceLine 素材占位",
                "/document/assets",
            )

        dialogues = (
            [block for block in fragment.blocks if isinstance(block, GalgameStoryDialogueBlock)]
            if fragment
            else []
        )
        bindings: list[GalgameAnnotationImportSegmentOut] = []
        dialogue_by_voice: dict[str, list[GalgameStoryDialogueBlock]] = {}
        for dialogue in dialogues:
            if dialogue.voice_asset_id:
                dialogue_by_voice.setdefault(dialogue.voice_asset_id, []).append(dialogue)
        segment_by_id = {segment.id: segment for segment in segments}
        multi_speaker_count = 0
        for index, voice_asset in enumerate(voice_assets):
            segment = segment_by_id.get(voice_asset.file_id)
            linked = dialogue_by_voice.get(voice_asset.id, [])
            if segment is None or len(linked) != 1:
                issue(
                    "dialogue_binding_mismatch",
                    "voiceLine 必须恰好绑定一条对应对白",
                    f"/document/assets/{index}",
                )
                continue
            dialogue = linked[0]
            source_speakers = segment.speaker_ids or body.segment_speaker_overrides.get(
                segment.id, []
            )
            story_speakers = [
                body.speaker_map[item] for item in source_speakers if item in body.speaker_map
            ]
            if len(source_speakers) > 1:
                multi_speaker_count += 1
            if dialogue.start_ms != segment.start_ms or dialogue.end_ms != segment.end_ms:
                issue(
                    "dialogue_time_mismatch",
                    "对白时间与标注片段不一致",
                    f"/document/blocks/{dialogue.id}",
                )
            if dialogue.text.strip() != _effective_text(segment):
                issue(
                    "dialogue_text_mismatch",
                    "对白中文与标注文档不一致",
                    f"/document/blocks/{dialogue.id}",
                )
            if dialogue.effective_speaker_ids != story_speakers:
                issue(
                    "dialogue_speaker_mismatch",
                    "对白说话人与标注映射不一致",
                    f"/document/blocks/{dialogue.id}",
                )
            bindings.append(
                GalgameAnnotationImportSegmentOut(
                    segmentId=segment.id,
                    blockId=dialogue.id,
                    storyAssetId=voice_asset.id,
                    startMs=segment.start_ms,
                    endMs=segment.end_ms,
                    text=_effective_text(segment),
                    sourceSpeakerIds=source_speakers,
                    storySpeakerIds=story_speakers,
                )
            )

        if len(dialogues) != requirements.segment_count or len(bindings) != len(segments):
            issue(
                "dialogue_count_mismatch",
                "Story 对白数量或绑定数量不符合要求",
                "/document/chapters",
            )
        if multi_speaker_count != requirements.multi_speaker_count:
            issue(
                "multi_speaker_count_mismatch",
                "多人对白数量不符合要求",
                "/requirements/multiSpeakerCount",
            )

        curtain_intervals = _curtain_intervals(segments, source.duration_ms)
        if len(curtain_intervals) != requirements.curtain_interval_count:
            issue(
                "curtain_interval_mismatch",
                "不少于 500ms 的幕布区间数量不符合要求",
                "/requirements/curtainIntervalCount",
            )
        curtain_events = (
            [block for block in fragment.blocks if block.type == "curtain"] if fragment else []
        )
        expected_curtain_events = max(0, len(curtain_intervals) * 2 - 1)
        if len(curtain_events) != expected_curtain_events:
            issue(
                "curtain_event_mismatch", "Story 幕布事件没有完整覆盖选定空档", "/document/chapters"
            )
        stage_transitions = (
            {
                block.at_ms
                for block in fragment.blocks
                if block.type == "removeCharacter" and block.all and block.at_ms not in {None, 0}
            }
            if fragment
            else set()
        )
        if len(stage_transitions) != requirements.stage_transition_count:
            issue(
                "stage_transition_mismatch",
                "舞台站位切换次数不符合要求",
                "/requirements/stageTransitionCount",
            )

        return GalgameAnnotationImportPreviewOut(
            ready=not issues,
            sourceProjectId=source.id,
            sourceRevision=document_row.revision,
            storyRevision=story.revision,
            sourceAssetId=source.asset_id,
            masterAssetId=body.master_asset_id,
            sourceChecksumSha256=source_checksum,
            timelineDurationMs=source.duration_ms,
            segmentCount=len(segments),
            speakerCount=len(speakers),
            multiSpeakerCount=multi_speaker_count,
            curtainIntervalCount=len(curtain_intervals),
            stageTransitionCount=len(stage_transitions),
            issues=issues,
            segments=sorted(bindings, key=lambda item: item.start_ms),
        )

    async def create(
        self, project_id: str, body: GalgameAnnotationImportIn
    ) -> GalgameAnnotationImportTaskOut:
        payload = body.model_dump(mode="json", by_alias=True)
        existing = await self.session.scalar(
            select(GalgameAnnotationImportTask).where(
                GalgameAnnotationImportTask.project_id == project_id,
                GalgameAnnotationImportTask.request_id == body.request_id,
            )
        )
        if existing is not None:
            if existing.request_payload != payload:
                raise AssetError(
                    "同一 requestId 已用于不同导入请求",
                    code="idempotency_conflict",
                    status=409,
                )
            return _task_out(existing)
        preview = await self.preview(project_id, body)
        if not preview.ready:
            raise AssetError(
                "广播剧导入预览未通过",
                code="annotation_import_not_ready",
                detail={"issues": [item.model_dump(mode="json") for item in preview.issues]},
            )
        task = GalgameAnnotationImportTask(
            project_id=project_id,
            source_project_id=body.source_project_id,
            request_id=body.request_id,
            expected_source_revision=body.expected_source_revision,
            expected_story_revision=body.expected_story_revision,
            request_payload=payload,
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return _task_out(task)

    async def get(self, project_id: str, import_id: str) -> GalgameAnnotationImportTaskOut:
        await self._target(project_id)
        task = await self.session.get(GalgameAnnotationImportTask, import_id)
        if task is None or task.project_id != project_id:
            raise AssetError("导入任务不存在", code="not_found", status=404)
        return _task_out(task)
