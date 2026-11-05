"""Freeze the approved Galgame Story and originals for Video handoff."""

from pydantic import ValidationError
from sqlalchemy import select, text

from app.capabilities.media_rendering.galgame.timing import COMPILER_VERSION
from studio.apps.galgame_workshop.exports.export_preflight import export_context, frozen_plan
from studio.apps.galgame_workshop.storage.models import (
    GalgameStorySnapshot,
    GalgameVideoEditorHandoffTask,
)
from studio.apps.galgame_workshop.storage.service_models import GalgameHandoffDispatch
from studio.apps.galgame_workshop.task_views import handoff_out
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.galgame_workshop.galgame_frames import MAX_FRAME_REQUEST
from studio.contracts.galgame_workshop.galgame_handoff import GalgameHandoff, HandoffSource
from studio.runtime.ids import new_id


async def prior_handoff(db, project, request_id, payload):
    row = await db.scalar(
        select(GalgameVideoEditorHandoffTask).where(
            GalgameVideoEditorHandoffTask.project_id == project,
            GalgameVideoEditorHandoffTask.request_id == request_id,
        )
    )
    if row is None:
        return None
    if any(row.request_payload.get(key) != value for key, value in payload.items()):
        raise AssetError(
            "同一 requestId 已用于不同剪辑交接请求", code="idempotency_conflict", status=409
        )
    return handoff_out(row)


async def enqueue_handoff(request, files, project, body):
    db, owner = files.session, files.projects.owner
    project_title = (await files.projects.row(project)).title
    payload = body.model_dump(mode="json", by_alias=True)
    if prior := await prior_handoff(db, project, body.request_id, payload):
        return prior
    story, assets, durations, preview = await export_context(request, files, project, body)
    detail = {"preview": preview.model_dump(mode="json", by_alias=True)}
    if body.preview_fingerprint != preview.preview_fingerprint:
        raise AssetError(
            "导出预览已失效，请重新检查后再发送到剪辑工坊",
            code="preview_conflict",
            status=409,
            detail=detail,
        )
    if not preview.ready:
        raise AssetError(
            "当前 Story 尚不能生成剪辑工程", code="video_handoff_not_ready", detail=detail
        )
    title = (body.title or "").strip() or f"{project_title} · Story r{story.revision}"
    try:
        plan = GalgameHandoff(
            **frozen_plan(story, assets, durations, preview, payload),
            title=title[:120],
            source_revision=story.revision,
            sources={
                key: HandoffSource(
                    **{name: getattr(asset, name) for name in HandoffSource.model_fields}
                )
                for key, asset in assets.items()
            },
        )
    except ValidationError as exc:
        raise AssetError("剪辑交接计划无效", code="video_handoff_not_ready") from exc
    if len(plan.model_dump_json().encode()) > MAX_FRAME_REQUEST:
        raise AssetError("Story 超过剪辑交接大小限制", code="handoff_request_too_large", status=413)
    await db.execute(text("BEGIN IMMEDIATE"))
    if prior := await prior_handoff(db, project, body.request_id, payload):
        return prior
    current = await files.projects.story(project)
    if current.revision != story.revision:
        raise AssetError("导出预览已失效，请重新预览路线", code="preview_conflict", status=409)
    snapshot = GalgameStorySnapshot(
        id=new_id(),
        project_id=project,
        story_revision=story.revision,
        reason="video-editor-handoff",
        document=plan.document,
    )
    db.add(snapshot)
    await db.flush()
    task = GalgameVideoEditorHandoffTask(
        owner_user_id=owner,
        project_id=project,
        snapshot_id=snapshot.id,
        request_id=body.request_id,
        story_revision=story.revision,
        request_payload={**plan.payload, "compilerVersion": COMPILER_VERSION},
        result_detail={
            "totalMs": plan.total_ms,
            "endingLabel": preview.route.ending_label,
            "fragmentDurationsMs": plan.fragment_durations_ms,
        },
    )
    db.add(task)
    await db.flush()
    db.add(
        GalgameHandoffDispatch(
            task_id=task.id,
            owner_user_id=owner,
            assertion=files.assertion,
            plan=plan.model_dump(mode="json"),
        )
    )
    result = handoff_out(task)
    await db.commit()
    return result
