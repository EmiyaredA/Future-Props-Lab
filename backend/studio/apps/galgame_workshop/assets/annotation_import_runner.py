from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.voice_clips import cut_verified_voice_clip
from studio.apps.audio_annotation.models import AudioAnnotationDocument, AudioAnnotationProject
from studio.apps.audio_annotation.schemas.document import AudioAnnotationSegment
from studio.apps.galgame_workshop.assets.annotation_import import GalgameAnnotationImports
from studio.apps.galgame_workshop.readiness import GalgameReadiness
from studio.apps.galgame_workshop.schemas import (
    GalgameAnnotationImportIn,
    GalgameAnnotationImportPreviewOut,
    GalgameStoryDialogueBlock,
    GalgameStoryDocumentPutIn,
)
from studio.apps.galgame_workshop.storage.models import (
    GalgameAnnotationImportTask,
    GalgameAssetMetadata,
    GalgameStorySnapshot,
    GalgameWorkshopProject,
)
from studio.apps.galgame_workshop.story.story import GalgameStoryDocuments
from studio.config.settings import Settings
from studio.runtime.database.ownership import bind_owner, require_owner_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


@dataclass(slots=True)
class AnnotationImportRun:
    task_id: str
    body: GalgameAnnotationImportIn
    project_id: str
    owner_user_id: str
    source_path: Path | None = None
    segments: list[AudioAnnotationSegment] = field(default_factory=list)
    preview: GalgameAnnotationImportPreviewOut | None = None
    snapshot_id: str | None = None
    saved_revision: int | None = None
    master_packaging_policy_before: str | None = None
    generated: dict[str, str] = field(default_factory=dict)
    audit_items: list[dict] = field(default_factory=list)


class GalgameAnnotationImportRunner(PollingTaskRunner):
    runner_name = "galgame-annotation-import-runner"
    poll_interval_seconds = 1.0

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings
        self.storage = AssetStorage(self.settings)

    async def _load(
        self, session: AsyncSession, task_id: str
    ) -> GalgameAnnotationImportTask | None:
        task = await session.get(GalgameAnnotationImportTask, task_id)
        if task is None:
            return None
        owner_user_id = require_owner_id(task.owner_user_id, subject="annotation import task")
        project = await session.get(GalgameWorkshopProject, task.project_id)
        if project is None or project.owner_user_id != owner_user_id:
            task.status = "failed"
            task.progress = 0
            task.result_detail = {"phase": "failed", "code": "account_mismatch"}
            task.error = "导入任务与目标项目的账号不一致，请重新创建任务"
            task.revision += 1
            task.updated_at = utc_now()
            task.finished_at = utc_now()
            await session.commit()
            return None
        bind_owner(session, owner_user_id)
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
        run: AnnotationImportRun | None = None
        try:
            run = await self._claim(task_id)
            if run is None or not await self._preflight(run):
                return
            await self._cut_and_stage(run)
            result = await self._save_and_accept(run)
            await self._update(
                task_id, status="completed", progress=100, result=result, finished=True
            )
        except RevisionConflictError as exc:
            await self._update(
                task_id,
                status="conflict",
                result={"phase": "conflict", "snapshotId": run.snapshot_id if run else None},
                error=str(exc),
                finished=True,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            rollback_error = await self._compensate(run, exc) if run else None
            if rollback_error == "":
                return
            await self._update(
                task_id,
                status="failed",
                result={
                    "phase": "failed",
                    "snapshotId": run.snapshot_id if run else None,
                    "voiceAssetCount": len(run.generated) if run else 0,
                    "segments": run.audit_items if run else [],
                },
                error=(f"{exc}；自动回滚失败：{rollback_error}" if rollback_error else str(exc))[
                    :4000
                ],
                finished=True,
            )

    async def _claim(self, task_id: str) -> AnnotationImportRun | None:
        async with self.session_factory() as session:
            task = await self._load(session, task_id)
            if task is None or task.status != "queued":
                return None
            task.status = "running"
            task.started_at = task.started_at or utc_now()
            task.error = None
            task.result_detail = {"phase": "cutting"}
            task.revision += 1
            task.updated_at = utc_now()
            run = AnnotationImportRun(
                task_id=task_id,
                body=GalgameAnnotationImportIn.model_validate(task.request_payload),
                project_id=task.project_id,
                owner_user_id=task.owner_user_id,
            )
            await session.commit()
            return run

    async def _preflight(self, run: AnnotationImportRun) -> bool:
        async with self.session_factory() as session:
            bind_owner(session, run.owner_user_id)
            imports = GalgameAnnotationImports(session, run.owner_user_id, self.settings)
            run.preview = await imports.preview(run.project_id, run.body)
            if not run.preview.ready:
                conflicts = {"source_revision_conflict", "story_revision_conflict"}
                status = (
                    "conflict"
                    if any(item.code in conflicts for item in run.preview.issues)
                    else "failed"
                )
                await self._update(
                    run.task_id,
                    status=status,
                    result={"phase": status},
                    error="；".join(item.message for item in run.preview.issues)[:4000],
                    finished=True,
                )
                return False
            source = await session.get(AudioAnnotationProject, run.body.source_project_id)
            source_document = await session.get(AudioAnnotationDocument, run.body.source_project_id)
            source_asset = await session.get(VisualAsset, source.asset_id) if source else None
            if source is None or source_document is None or source_asset is None:
                raise RuntimeError("广播剧源数据已不存在")
            run.source_path = self.storage.path_for(source_asset)
            run.segments = [
                AudioAnnotationSegment.model_validate(item) for item in source_document.segments
            ]
            story = await GalgameStoryDocuments(session).get(run.project_id)
            snapshot = GalgameStorySnapshot(
                project_id=run.project_id,
                story_revision=story.revision,
                reason="audio-annotation-import",
                document=story.document.model_dump(mode="json", by_alias=True),
            )
            session.add(snapshot)
            await session.commit()
            await session.refresh(snapshot)
            run.snapshot_id = snapshot.id
            return True

    async def _cut_and_stage(self, run: AnnotationImportRun) -> None:
        if run.source_path is None:
            raise RuntimeError("广播剧源文件不存在")
        with TemporaryDirectory(prefix=f"galgame-annotation-{run.task_id}-") as temp_dir:
            for index, segment in enumerate(run.segments):
                filename = f"{run.body.asset_prefix}-{index + 1:04d}.m4a"
                output_path = Path(temp_dir) / filename
                metrics = await cut_verified_voice_clip(
                    run.source_path,
                    output_path,
                    start_ms=segment.start_ms,
                    end_ms=segment.end_ms,
                    max_duration_difference_ms=run.body.requirements.max_duration_difference_ms,
                    min_content_correlation=run.body.requirements.min_content_correlation,
                )
                asset_id = await self._stage_clip(
                    run,
                    output_path=output_path,
                    filename=filename,
                    checksum=metrics[3],
                    duration_ms=metrics[0],
                )
                run.generated[segment.id] = asset_id
                run.audit_items.append(
                    {
                        "index": index + 1,
                        "segmentId": segment.id,
                        "startMs": segment.start_ms,
                        "endMs": segment.end_ms,
                        "expectedDurationMs": segment.end_ms - segment.start_ms,
                        "encodedDurationMs": metrics[0],
                        "durationDifferenceMs": metrics[1],
                        "contentCorrelation": metrics[2],
                        "checksumSha256": metrics[3],
                        "assetId": asset_id,
                        "filename": filename,
                    }
                )
                if index % 5 == 4 or index + 1 == len(run.segments):
                    await self._update(
                        run.task_id,
                        progress=min(94, 2 + round((index + 1) / len(run.segments) * 90)),
                        result={
                            "phase": "validating",
                            "snapshotId": run.snapshot_id,
                            "generatedAssets": index + 1,
                            "totalAssets": len(run.segments),
                        },
                    )

    async def _stage_clip(
        self,
        run: AnnotationImportRun,
        *,
        output_path: Path,
        filename: str,
        checksum: str,
        duration_ms: int,
    ) -> str:
        virtual_path = f"voice/{filename}"
        async with self.session_factory() as session:
            bind_owner(session, run.owner_user_id)
            existing = (
                await session.execute(
                    select(VisualAsset, GalgameAssetMetadata)
                    .join(GalgameAssetMetadata, GalgameAssetMetadata.asset_id == VisualAsset.id)
                    .where(
                        GalgameAssetMetadata.project_id == run.project_id,
                        GalgameAssetMetadata.virtual_path == virtual_path,
                    )
                )
            ).first()
            if existing is not None:
                asset, metadata = existing
                if metadata.checksum_sha256 != checksum:
                    raise RuntimeError(f"{virtual_path} 已存在但内容不同")
                return asset.id
            asset, staged_path = await AssetLibrary(session, self.settings).stage_local_copy(
                output_path,
                owner_user_id=run.owner_user_id,
                filename=filename,
                content_type="audio/mp4",
                galgame_project_id=run.project_id,
                allowed_extensions={".m4a"},
            )
            try:
                session.add(
                    GalgameAssetMetadata(
                        asset_id=asset.id,
                        project_id=run.project_id,
                        category="voice",
                        virtual_path=virtual_path,
                        checksum_sha256=checksum,
                        duration_ms=duration_ms,
                        transcript_status="pending",
                    )
                )
                await session.commit()
            except Exception:
                await session.rollback()
                staged_path.unlink(missing_ok=True)
                raise
            return asset.id

    async def _save_and_accept(self, run: AnnotationImportRun) -> dict:
        await self._update(
            run.task_id,
            progress=95,
            result={
                "phase": "saving",
                "snapshotId": run.snapshot_id,
                "generatedAssets": len(run.segments),
                "totalAssets": len(run.segments),
            },
        )
        payload = run.body.document.model_dump(mode="json", by_alias=True)
        for asset in payload["assets"]:
            if asset.get("role") == "voiceLine":
                asset["fileId"] = run.generated[asset["fileId"]]
        async with self.session_factory() as session:
            bind_owner(session, run.owner_user_id)
            master = await session.get(GalgameAssetMetadata, run.body.master_asset_id)
            if master is None or master.project_id != run.project_id:
                raise RuntimeError("完整主音轨素材元数据已不存在")
            run.master_packaging_policy_before = master.packaging_policy
            if master.packaging_policy == "exclude":
                master.packaging_policy = "include"
                master.updated_at = utc_now()
            saved = await GalgameStoryDocuments(session).put(
                run.project_id,
                GalgameStoryDocumentPutIn.model_validate(
                    {"expected_revision": run.body.expected_story_revision, "document": payload}
                ),
            )
            run.saved_revision = saved.revision
            await self._update(
                run.task_id,
                progress=98,
                result={
                    "phase": "accepting",
                    "snapshotId": run.snapshot_id,
                    "storyRevision": run.saved_revision,
                },
            )
            report = await GalgameReadiness(session, self.settings, run.owner_user_id).report(
                run.project_id
            )
            if not report.ready or report.errors or report.warnings:
                messages = [issue.message for issue in report.errors + report.warnings]
                raise RuntimeError("线路报告未通过：" + "；".join(messages))
            reread = await GalgameStoryDocuments(session).get(run.project_id)
            fragments = [item for chapter in reread.document.chapters for item in chapter.fragments]
            dialogues = [
                block
                for fragment in fragments
                for block in fragment.blocks
                if isinstance(block, GalgameStoryDialogueBlock)
            ]
            if len(fragments) != 1 or len(dialogues) != run.body.requirements.segment_count:
                raise RuntimeError("保存后 Story 数量验收失败")
            preview = run.preview
            if preview is None:
                raise RuntimeError("导入预检结果不存在")
            return {
                "phase": "completed",
                "snapshotId": run.snapshot_id,
                "storyRevision": reread.revision,
                "sourceAssetId": preview.source_asset_id,
                "masterAssetId": preview.master_asset_id,
                "sourceChecksumSha256": preview.source_checksum_sha256,
                "timelineDurationMs": preview.timeline_duration_ms,
                "dialogueCount": len(dialogues),
                "voiceAssetCount": len(run.generated),
                "speakerCount": preview.speaker_count,
                "multiSpeakerCount": preview.multi_speaker_count,
                "curtainIntervalCount": preview.curtain_interval_count,
                "stageTransitionCount": preview.stage_transition_count,
                "maximumDurationDifferenceMs": max(
                    item["durationDifferenceMs"] for item in run.audit_items
                ),
                "minimumContentCorrelation": min(
                    item["contentCorrelation"] for item in run.audit_items
                ),
                "ready": report.ready,
                "errors": report.errors,
                "warnings": report.warnings,
                "segments": run.audit_items,
            }

    async def _compensate(self, run: AnnotationImportRun, exc: Exception) -> str | None:
        if run.saved_revision is None or run.snapshot_id is None:
            return None
        try:
            await self._update(
                run.task_id,
                progress=99,
                result={
                    "phase": "rolling_back",
                    "snapshotId": run.snapshot_id,
                    "storyRevision": run.saved_revision,
                },
            )
            async with self.session_factory() as session:
                task = await self._load(session, run.task_id)
                snapshot = await session.get(GalgameStorySnapshot, run.snapshot_id)
                if task is not None and snapshot is not None:
                    if run.master_packaging_policy_before is not None:
                        master = await session.get(
                            GalgameAssetMetadata, task.request_payload["masterAssetId"]
                        )
                        if master is not None:
                            master.packaging_policy = run.master_packaging_policy_before
                            master.updated_at = utc_now()
                    await GalgameStoryDocuments(session).put(
                        task.project_id,
                        GalgameStoryDocumentPutIn.model_validate(
                            {
                                "expected_revision": run.saved_revision,
                                "document": snapshot.document,
                            }
                        ),
                    )
            await self._update(
                run.task_id,
                status="rolled_back",
                progress=100,
                result={
                    "phase": "rolled_back",
                    "snapshotId": run.snapshot_id,
                    "rolledBackFromRevision": run.saved_revision,
                    "voiceAssetCount": len(run.generated),
                    "segments": run.audit_items,
                },
                error=str(exc)[:4000],
                finished=True,
            )
            return ""
        except Exception as rollback_exc:
            return str(rollback_exc)
