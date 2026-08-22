from __future__ import annotations

import asyncio
import hashlib
import math
import struct
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.concurrency.revisions import RevisionConflictError
from app.core.config import Settings, get_settings
from app.core.db import SessionLocal
from app.core.tenant_context import bind_workspace
from app.core.time import iso_utc, utc_now
from app.files import AssetError
from app.files.library import AssetLibrary
from app.files.storage import AssetStorage
from app.galgame_workshop.readiness import GalgameReadiness
from app.galgame_workshop.story import GalgameStoryDocuments
from app.llm.generation_runtime import PollingGenerationRunner
from app.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    GalgameAnnotationImportTask,
    GalgameAssetMetadata,
    GalgameStorySnapshot,
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
    GalgameStoryDocumentPutIn,
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


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


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
        source_checksum = await asyncio.to_thread(_sha256, source_path)
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


def _run_checked(args: list[str], *, capture: bool = False) -> bytes:
    try:
        result = subprocess.run(
            args,
            check=True,
            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"缺少音频处理程序：{args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"音频处理失败：{message[-1000:]}") from exc
    return result.stdout


def _probe_duration_ms(path: Path) -> int:
    output = _run_checked(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture=True,
    )
    return round(float(output.decode().strip()) * 1000)


def _audio_envelope(
    path: Path, start_ms: int | None = None, end_ms: int | None = None
) -> list[float]:
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    if start_ms is not None:
        args.extend(["-ss", f"{start_ms / 1000:.3f}"])
    if end_ms is not None:
        args.extend(["-to", f"{end_ms / 1000:.3f}"])
    args.extend(["-i", str(path), "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"])
    pcm = _run_checked(args, capture=True)
    values: list[float] = []
    samples = struct.iter_unpack("<h", pcm[: len(pcm) - len(pcm) % 2])
    window: list[float] = []
    for (sample,) in samples:
        window.append(sample / 32768)
        if len(window) == 160:
            values.append(math.sqrt(sum(value * value for value in window) / len(window)))
            window.clear()
    return values


def _envelope_correlation(left: list[float], right: list[float]) -> float:
    best = -1.0
    for lag in range(-5, 6):
        left_start = max(0, lag)
        right_start = max(0, -lag)
        length = min(len(left) - left_start, len(right) - right_start)
        if length < 10:
            continue
        left_values = left[left_start : left_start + length]
        right_values = right[right_start : right_start + length]
        left_mean = sum(left_values) / length
        right_mean = sum(right_values) / length
        numerator = sum(
            (left_value - left_mean) * (right_value - right_mean)
            for left_value, right_value in zip(left_values, right_values, strict=True)
        )
        left_energy = sum((value - left_mean) ** 2 for value in left_values)
        right_energy = sum((value - right_mean) ** 2 for value in right_values)
        denominator = math.sqrt(left_energy * right_energy)
        if denominator > 0:
            best = max(best, numerator / denominator)
    return best


class GalgameAnnotationImportRunner(PollingGenerationRunner):
    runner_name = "galgame-annotation-import-runner"
    poll_interval_seconds = 1.0

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] = SessionLocal,
        settings: Settings | None = None,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

    async def _load(
        self, session: AsyncSession, task_id: str
    ) -> GalgameAnnotationImportTask | None:
        task = await session.get(GalgameAnnotationImportTask, task_id)
        if task is not None:
            bind_workspace(session, task.workspace_id)
        return task

    async def recover(self) -> None:
        async with self.session_factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(GalgameAnnotationImportTask).where(
                            GalgameAnnotationImportTask.status == "running"
                        )
                    )
                ).scalars()
            )
            for row in rows:
                row.status = "queued"
                row.error = None
                row.result_detail = {"phase": "queued"}
                row.revision += 1
                row.updated_at = utc_now()
            await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_id = await session.scalar(
                select(GalgameAnnotationImportTask.id)
                .where(GalgameAnnotationImportTask.status == "queued")
                .order_by(GalgameAnnotationImportTask.created_at)
                .limit(1)
            )
        if task_id:
            await self._process(task_id)

    async def _update(
        self,
        task_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        result: dict | None = None,
        error: str | None = None,
        finished: bool = False,
    ) -> None:
        async with self.session_factory() as session:
            task = await self._load(session, task_id)
            if task is None:
                return
            if status is not None:
                task.status = status
            if progress is not None:
                task.progress = progress
            if result is not None:
                task.result_detail = result
            task.error = error
            task.revision += 1
            task.updated_at = utc_now()
            if finished:
                task.finished_at = utc_now()
            await session.commit()

    async def _process(self, task_id: str) -> None:
        saved_revision: int | None = None
        snapshot_id: str | None = None
        master_packaging_policy_before: str | None = None
        generated: dict[str, str] = {}
        audit_items: list[dict] = []
        try:
            async with self.session_factory() as session:
                task = await self._load(session, task_id)
                if task is None or task.status != "queued":
                    return
                task.status = "running"
                task.started_at = task.started_at or utc_now()
                task.error = None
                task.result_detail = {"phase": "cutting"}
                task.revision += 1
                task.updated_at = utc_now()
                body = GalgameAnnotationImportIn.model_validate(task.request_payload)
                project_id = task.project_id
                await session.commit()

            async with self.session_factory() as session:
                bind_workspace(session, task.workspace_id)
                imports = GalgameAnnotationImports(session, self.settings)
                preview = await imports.preview(project_id, body)
                if not preview.ready:
                    conflicts = {"source_revision_conflict", "story_revision_conflict"}
                    status = (
                        "conflict"
                        if any(item.code in conflicts for item in preview.issues)
                        else "failed"
                    )
                    await self._update(
                        task_id,
                        status=status,
                        result={"phase": status},
                        error="；".join(item.message for item in preview.issues)[:4000],
                        finished=True,
                    )
                    return
                source = await session.get(AudioAnnotationProject, body.source_project_id)
                source_document = await session.get(AudioAnnotationDocument, body.source_project_id)
                source_asset = await session.get(VisualAsset, source.asset_id) if source else None
                if source is None or source_document is None or source_asset is None:
                    raise RuntimeError("广播剧源数据已不存在")
                source_path = self.storage.path_for(source_asset)
                segments = [
                    AudioAnnotationSegment.model_validate(item) for item in source_document.segments
                ]
                story = await GalgameStoryDocuments(session).get(project_id)
                snapshot = GalgameStorySnapshot(
                    project_id=project_id,
                    story_revision=story.revision,
                    reason="audio-annotation-import",
                    document=story.document.model_dump(mode="json", by_alias=True),
                )
                session.add(snapshot)
                await session.commit()
                await session.refresh(snapshot)
                snapshot_id = snapshot.id

            with TemporaryDirectory(prefix=f"galgame-annotation-{task_id}-") as temp_dir:
                temporary_root = Path(temp_dir)
                for index, segment in enumerate(segments):
                    filename = f"{body.asset_prefix}-{index + 1:04d}.m4a"
                    virtual_path = f"voice/{filename}"
                    output_path = temporary_root / filename
                    expected_ms = segment.end_ms - segment.start_ms
                    await asyncio.to_thread(
                        _run_checked,
                        [
                            "ffmpeg",
                            "-hide_banner",
                            "-loglevel",
                            "error",
                            "-y",
                            "-i",
                            str(source_path),
                            "-vn",
                            "-af",
                            (
                                f"atrim=start={segment.start_ms / 1000:.3f}:"
                                f"end={segment.end_ms / 1000:.3f},asetpts=PTS-STARTPTS"
                            ),
                            "-c:a",
                            "aac",
                            "-b:a",
                            "128k",
                            "-movflags",
                            "+faststart",
                            str(output_path),
                        ],
                    )
                    actual_ms = await asyncio.to_thread(_probe_duration_ms, output_path)
                    difference_ms = abs(actual_ms - expected_ms)
                    if difference_ms > body.requirements.max_duration_difference_ms:
                        raise RuntimeError(f"{filename} 时长误差 {difference_ms}ms")
                    source_envelope, clip_envelope = await asyncio.gather(
                        asyncio.to_thread(
                            _audio_envelope, source_path, segment.start_ms, segment.end_ms
                        ),
                        asyncio.to_thread(_audio_envelope, output_path),
                    )
                    correlation = _envelope_correlation(source_envelope, clip_envelope)
                    if correlation < body.requirements.min_content_correlation:
                        raise RuntimeError(f"{filename} 内容相关度过低：{correlation:.4f}")
                    checksum = await asyncio.to_thread(_sha256, output_path)

                    async with self.session_factory() as session:
                        bind_workspace(session, task.workspace_id)
                        existing = (
                            await session.execute(
                                select(VisualAsset, GalgameAssetMetadata)
                                .join(
                                    GalgameAssetMetadata,
                                    GalgameAssetMetadata.asset_id == VisualAsset.id,
                                )
                                .where(
                                    GalgameAssetMetadata.project_id == project_id,
                                    GalgameAssetMetadata.virtual_path == virtual_path,
                                )
                            )
                        ).first()
                        if existing is not None:
                            asset, metadata = existing
                            if metadata.checksum_sha256 != checksum:
                                raise RuntimeError(f"{virtual_path} 已存在但内容不同")
                        else:
                            library = AssetLibrary(session, self.settings)
                            asset, staged_path = await library.stage_local_copy(
                                output_path,
                                filename=filename,
                                content_type="audio/mp4",
                                galgame_project_id=project_id,
                                allowed_extensions={".m4a"},
                            )
                            try:
                                metadata = GalgameAssetMetadata(
                                    asset_id=asset.id,
                                    project_id=project_id,
                                    category="voice",
                                    virtual_path=virtual_path,
                                    checksum_sha256=checksum,
                                    duration_ms=actual_ms,
                                    transcript_status="pending",
                                )
                                session.add(metadata)
                                await session.commit()
                            except Exception:
                                await session.rollback()
                                staged_path.unlink(missing_ok=True)
                                raise
                        generated[segment.id] = asset.id
                    audit_items.append(
                        {
                            "index": index + 1,
                            "segmentId": segment.id,
                            "startMs": segment.start_ms,
                            "endMs": segment.end_ms,
                            "expectedDurationMs": expected_ms,
                            "encodedDurationMs": actual_ms,
                            "durationDifferenceMs": difference_ms,
                            "contentCorrelation": correlation,
                            "checksumSha256": checksum,
                            "assetId": generated[segment.id],
                            "filename": filename,
                        }
                    )
                    if index % 5 == 4 or index + 1 == len(segments):
                        await self._update(
                            task_id,
                            progress=min(94, 2 + round((index + 1) / len(segments) * 90)),
                            result={
                                "phase": "validating",
                                "snapshotId": snapshot_id,
                                "generatedAssets": index + 1,
                                "totalAssets": len(segments),
                            },
                        )

            await self._update(
                task_id,
                progress=95,
                result={
                    "phase": "saving",
                    "snapshotId": snapshot_id,
                    "generatedAssets": len(segments),
                    "totalAssets": len(segments),
                },
            )
            payload = body.document.model_dump(mode="json", by_alias=True)
            for asset in payload["assets"]:
                if asset.get("role") == "voiceLine":
                    asset["fileId"] = generated[asset["fileId"]]

            async with self.session_factory() as session:
                bind_workspace(session, task.workspace_id)
                master_metadata = await session.get(GalgameAssetMetadata, body.master_asset_id)
                if master_metadata is None or master_metadata.project_id != project_id:
                    raise RuntimeError("完整主音轨素材元数据已不存在")
                master_packaging_policy_before = master_metadata.packaging_policy
                if master_metadata.packaging_policy == "exclude":
                    master_metadata.packaging_policy = "include"
                    master_metadata.updated_at = utc_now()
                saved = await GalgameStoryDocuments(session).put(
                    project_id,
                    GalgameStoryDocumentPutIn.model_validate(
                        {
                            "expected_revision": body.expected_story_revision,
                            "document": payload,
                        }
                    ),
                )
                saved_revision = saved.revision
                await self._update(
                    task_id,
                    progress=98,
                    result={
                        "phase": "accepting",
                        "snapshotId": snapshot_id,
                        "storyRevision": saved_revision,
                    },
                )
                report = await GalgameReadiness(session, self.settings).report(project_id)
                if not report.ready or report.errors or report.warnings:
                    messages = [issue.message for issue in report.errors + report.warnings]
                    raise RuntimeError("线路报告未通过：" + "；".join(messages))
                reread = await GalgameStoryDocuments(session).get(project_id)
                fragments = [
                    fragment
                    for chapter in reread.document.chapters
                    for fragment in chapter.fragments
                ]
                dialogues = [
                    block
                    for fragment in fragments
                    for block in fragment.blocks
                    if isinstance(block, GalgameStoryDialogueBlock)
                ]
                if len(fragments) != 1 or len(dialogues) != body.requirements.segment_count:
                    raise RuntimeError("保存后 Story 数量验收失败")
                result = {
                    "phase": "completed",
                    "snapshotId": snapshot_id,
                    "storyRevision": reread.revision,
                    "sourceAssetId": preview.source_asset_id,
                    "masterAssetId": preview.master_asset_id,
                    "sourceChecksumSha256": preview.source_checksum_sha256,
                    "timelineDurationMs": preview.timeline_duration_ms,
                    "dialogueCount": len(dialogues),
                    "voiceAssetCount": len(generated),
                    "speakerCount": preview.speaker_count,
                    "multiSpeakerCount": preview.multi_speaker_count,
                    "curtainIntervalCount": preview.curtain_interval_count,
                    "stageTransitionCount": preview.stage_transition_count,
                    "maximumDurationDifferenceMs": max(
                        item["durationDifferenceMs"] for item in audit_items
                    ),
                    "minimumContentCorrelation": min(
                        item["contentCorrelation"] for item in audit_items
                    ),
                    "ready": report.ready,
                    "errors": report.errors,
                    "warnings": report.warnings,
                    "segments": audit_items,
                }
            await self._update(
                task_id,
                status="completed",
                progress=100,
                result=result,
                finished=True,
            )
        except RevisionConflictError as exc:
            await self._update(
                task_id,
                status="conflict",
                result={"phase": "conflict", "snapshotId": snapshot_id},
                error=str(exc),
                finished=True,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            rollback_error: str | None = None
            if saved_revision is not None and snapshot_id is not None:
                try:
                    await self._update(
                        task_id,
                        progress=99,
                        result={
                            "phase": "rolling_back",
                            "snapshotId": snapshot_id,
                            "storyRevision": saved_revision,
                        },
                    )
                    async with self.session_factory() as session:
                        task = await self._load(session, task_id)
                        snapshot = await session.get(GalgameStorySnapshot, snapshot_id)
                        if task is not None and snapshot is not None:
                            if master_packaging_policy_before is not None:
                                master_metadata = await session.get(
                                    GalgameAssetMetadata,
                                    task.request_payload["masterAssetId"],
                                )
                                if master_metadata is not None:
                                    master_metadata.packaging_policy = (
                                        master_packaging_policy_before
                                    )
                                    master_metadata.updated_at = utc_now()
                            await GalgameStoryDocuments(session).put(
                                task.project_id,
                                GalgameStoryDocumentPutIn.model_validate(
                                    {
                                        "expected_revision": saved_revision,
                                        "document": snapshot.document,
                                    }
                                ),
                            )
                    await self._update(
                        task_id,
                        status="rolled_back",
                        progress=100,
                        result={
                            "phase": "rolled_back",
                            "snapshotId": snapshot_id,
                            "rolledBackFromRevision": saved_revision,
                            "voiceAssetCount": len(generated),
                            "segments": audit_items,
                        },
                        error=str(exc)[:4000],
                        finished=True,
                    )
                    return
                except Exception as rollback_exc:
                    rollback_error = str(rollback_exc)
            await self._update(
                task_id,
                status="failed",
                result={
                    "phase": "failed",
                    "snapshotId": snapshot_id,
                    "voiceAssetCount": len(generated),
                    "segments": audit_items,
                },
                error=(f"{exc}；自动回滚失败：{rollback_error}" if rollback_error else str(exc))[
                    :4000
                ],
                finished=True,
            )
