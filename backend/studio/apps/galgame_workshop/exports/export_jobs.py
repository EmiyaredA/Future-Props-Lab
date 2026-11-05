"""Freeze the approved Story and exact files in the Galgame export receipt."""

from pydantic import ValidationError
from sqlalchemy import select, text

from app.capabilities.media_rendering.galgame.export_output import safe_filename
from app.capabilities.media_rendering.galgame.timing import COMPILER_VERSION
from studio.apps.galgame_workshop.exports.export_preflight import export_context, frozen_plan
from studio.apps.galgame_workshop.storage.models import GalgameStorySnapshot, GalgameVideoExportTask
from studio.apps.galgame_workshop.storage.service_models import GalgameVideoDispatch
from studio.apps.galgame_workshop.task_views import export_task_out
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.galgame_workshop.galgame_exports import GalgameExport
from studio.contracts.galgame_workshop.galgame_frames import MAX_FRAME_REQUEST
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


async def prior_export(db, project, request_id, payload):
    prior = await db.scalar(
        select(GalgameVideoExportTask).where(
            GalgameVideoExportTask.project_id == project,
            GalgameVideoExportTask.request_id == request_id,
        )
    )
    if prior is not None:
        if any(prior.request_payload.get(key) != value for key, value in payload.items()):
            raise AssetError(
                "同一 requestId 已用于不同导出请求", code="idempotency_conflict", status=409
            )
        return export_task_out(prior)
    return None


async def enqueue_export(request, files, project, body):
    db, owner = files.session, files.projects.owner
    title = (await files.projects.row(project)).title
    payload = body.model_dump(mode="json", by_alias=True)
    if prior := await prior_export(db, project, body.request_id, payload):
        return prior
    story, assets, durations, preview = await export_context(request, files, project, body)
    detail = {"preview": preview.model_dump(mode="json", by_alias=True)}
    if body.preview_fingerprint != preview.preview_fingerprint:
        raise AssetError(
            "导出预览已失效，请重新预览路线", code="preview_conflict", status=409, detail=detail
        )
    if not preview.ready:
        raise AssetError("视频导出预览未通过", code="video_export_not_ready", detail=detail)
    task_id, snapshot_id = new_id(), new_id()
    label = safe_filename(title)[:96]
    ending = safe_filename(preview.route.ending_label)[:96]
    timestamp = utc_now().strftime("%Y%m%d-%H%M%S")
    filename = f"{label}-{ending}-{timestamp}-{task_id[:8]}.mp4"
    try:
        plan = GalgameExport(
            **frozen_plan(story, assets, durations, preview, payload), filename=filename
        )
    except ValidationError as exc:
        raise AssetError("视频导出计划无效", code="video_export_compilation_failed") from exc
    if len(plan.model_dump_json().encode()) > MAX_FRAME_REQUEST:
        raise AssetError("Story 超过视频导出大小限制", code="export_request_too_large", status=413)
    await db.execute(text("BEGIN IMMEDIATE"))
    if prior := await prior_export(db, project, body.request_id, payload):
        return prior
    current = await files.projects.story(project)
    if current.revision != story.revision:
        raise AssetError("导出预览已失效，请重新预览路线", code="preview_conflict", status=409)
    db.add(
        GalgameStorySnapshot(
            id=snapshot_id,
            project_id=project,
            story_revision=story.revision,
            reason="video-export",
            document=plan.document,
        )
    )
    await db.flush()
    task = GalgameVideoExportTask(
        id=task_id,
        owner_user_id=owner,
        project_id=project,
        snapshot_id=snapshot_id,
        request_id=body.request_id,
        story_revision=story.revision,
        request_payload={**plan.payload, "compilerVersion": COMPILER_VERSION},
        result_detail={
            "phase": "queued",
            "renderedMs": 0,
            "totalMs": plan.total_ms,
            "endingLabel": preview.route.ending_label,
            "fragmentDurationsMs": preview.route.fragment_durations_ms,
        },
    )
    db.add(task)
    await db.flush()
    db.add(
        GalgameVideoDispatch(
            task_id=task_id,
            owner_user_id=owner,
            assertion=files.assertion,
            plan=plan.model_dump(mode="json"),
        )
    )
    result = export_task_out(task)
    await db.commit()
    return result
