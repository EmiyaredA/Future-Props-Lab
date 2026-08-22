from __future__ import annotations

import asyncio
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
from app.core.time import utc_now
from app.files.library import AssetLibrary
from app.files.storage import AssetStorage
from app.galgame_workshop.annotation_import import GalgameAnnotationImports, _sha256
from app.galgame_workshop.readiness import GalgameReadiness
from app.galgame_workshop.story import GalgameStoryDocuments
from app.llm.generation_runtime import PollingGenerationRunner
from app.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    GalgameAnnotationImportTask,
    GalgameAssetMetadata,
    GalgameStorySnapshot,
    VisualAsset,
)
from app.schemas.audio_annotation import AudioAnnotationSegment
from app.schemas.galgame_workshop import (
    GalgameAnnotationImportIn,
    GalgameStoryDialogueBlock,
    GalgameStoryDocumentPutIn,
)


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
