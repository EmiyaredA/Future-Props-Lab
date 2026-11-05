"""Commit an accepted Annotation Story, its prior snapshot and the task receipt together."""

from sqlalchemy import select

from app.apps.galgame_workshop.models import (
    GalgameAnnotationImportTask,
    GalgameAssetMetadata,
    GalgameStorySnapshot,
)
from app.apps.galgame_workshop.story.document_values import normalize_story_document
from app.runtime.ids import new_id
from app.runtime.time import utc_now
from fpl_runtime.project_errors import ProjectResourceError

from .models import GalgameAnnotationAuthorization
from .story_writes import StoryWrites


async def accepted_files(files, project, document):
    ids = {asset.file_id for asset in document.assets}
    records = await files.asset_records(project, ids, newest_first=False)
    originals = {row.id: row for row, _ in records}
    for missing in sorted(ids - originals.keys()):
        exact = await files.asset_records(
            project, (), newest_first=False, project_file_id=missing, replacement=True
        )
        if exact:
            originals[missing] = exact[0][0]
    return tuple(originals.values())


async def publish_annotation(files, references, task_id, project, body, preview, audit):
    writes = StoryWrites(files.session, files.projects.owner, references, files.assertion)
    old = await writes.current_story(project, body.expected_story_revision)
    raw = body.document.model_dump(mode="json", by_alias=True)
    clips = {item["segmentId"]: item["assetId"] for item in audit}
    for asset in raw["assets"]:
        if asset.get("role") == "voiceLine":
            asset["fileId"] = clips[asset["fileId"]]
    document = normalize_story_document(raw)
    originals = await accepted_files(files, project, document)
    snapshot = GalgameStorySnapshot(
        id=new_id(),
        project_id=project,
        story_revision=old.revision,
        reason="audio-annotation-import",
        document=old.document.model_dump(mode="json", by_alias=True),
    )

    async def finish(saved):
        db = files.session
        task = await db.get(GalgameAnnotationImportTask, task_id)
        authorization = await db.get(GalgameAnnotationAuthorization, task_id)
        if task is None or task.status != "running" or authorization is None:
            raise ProjectResourceError("广播剧任务已结束", "annotation_task_ended", 409)
        local_metadata = {
            row.asset_id: row
            for row in await db.scalars(
                select(GalgameAssetMetadata).where(GalgameAssetMetadata.project_id == project)
            )
        }
        master = local_metadata.get(preview.master_asset_id)
        if master is None or (
            master.checksum_sha256 != preview.source_checksum_sha256
            or master.duration_ms != preview.timeline_duration_ms
        ):
            raise ProjectResourceError("完整主音轨素材已变化", "annotation_master_changed", 409)
        for item in audit:
            metadata = local_metadata.get(item["assetId"])
            if metadata is None or metadata.checksum_sha256 != item["checksumSha256"]:
                raise ProjectResourceError("台词素材已变化", "annotation_clip_changed", 409)
        if master.packaging_policy == "exclude":
            master.packaging_policy = "include"
            master.updated_at = utc_now()
        report = files.report_from_records(
            project,
            saved.revision,
            document,
            [(row, local_metadata.get(row.id)) for row in originals],
        )
        if not report.ready or report.errors or report.warnings:
            messages = "；".join(issue.message for issue in (*report.errors, *report.warnings))
            raise ProjectResourceError(
                "线路报告未通过：" + messages, "annotation_report_failed", 422
            )
        now = utc_now()
        task.status, task.progress, task.error = "completed", 100, None
        task.finished_at, task.updated_at = now, now
        task.revision += 1
        task.result_detail = {
            "phase": "completed",
            "snapshotId": snapshot.id,
            "storyRevision": saved.revision,
            "sourceAssetId": preview.source_asset_id,
            "masterAssetId": preview.master_asset_id,
            "sourceChecksumSha256": preview.source_checksum_sha256,
            "timelineDurationMs": preview.timeline_duration_ms,
            "dialogueCount": preview.segment_count,
            "voiceAssetCount": len(audit),
            "speakerCount": preview.speaker_count,
            "multiSpeakerCount": preview.multi_speaker_count,
            "curtainIntervalCount": preview.curtain_interval_count,
            "stageTransitionCount": preview.stage_transition_count,
            "maximumDurationDifferenceMs": max(item["durationDifferenceMs"] for item in audit),
            "minimumContentCorrelation": min(item["contentCorrelation"] for item in audit),
            "ready": True,
            "errors": [],
            "warnings": [],
            "segments": audit,
        }
        await db.delete(authorization)

    return await writes._save(
        project,
        expected_revision=old.revision,
        document=document,
        method="POST",
        path=files.source_path,
        snapshot=snapshot,
        before_commit=finish,
    )
