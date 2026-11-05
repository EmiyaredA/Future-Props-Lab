"""Enqueue one idempotent Annotation job after checking the current source and Story."""

from sqlalchemy import select, text

from app.capabilities.asset_store.errors import AssetError
from studio.apps.galgame_workshop.annotation.annotation_preview import annotation_preview
from studio.apps.galgame_workshop.storage.models import GalgameAnnotationImportTask
from studio.apps.galgame_workshop.storage.service_models import GalgameAnnotationAuthorization
from studio.apps.galgame_workshop.task_views import annotation_task_out
from studio.runtime.project_errors import ProjectResourceError


async def prior_job(files, project_id, request_id, payload):
    task = await files.session.scalar(
        select(GalgameAnnotationImportTask).where(
            GalgameAnnotationImportTask.owner_user_id == files.projects.owner,
            GalgameAnnotationImportTask.project_id == project_id,
            GalgameAnnotationImportTask.request_id == request_id,
        )
    )
    if task is None:
        return None
    if task.request_payload != payload:
        raise ProjectResourceError("同一 requestId 已用于不同导入请求", "idempotency_conflict", 409)
    return annotation_task_out(task)


async def enqueue_import(files, project_id, body):
    db, owner = files.session, files.projects.owner
    payload = body.model_dump(mode="json", by_alias=True)
    await files.projects.row(project_id)
    if existing := await prior_job(files, project_id, body.request_id, payload):
        return existing
    preview = await annotation_preview(files, project_id, body)
    if not preview.ready:
        raise AssetError(
            "广播剧导入预览未通过",
            code="annotation_import_not_ready",
            detail={"issues": [item.model_dump(mode="json") for item in preview.issues]},
        )
    await db.rollback()
    await db.execute(text("BEGIN IMMEDIATE"))
    if existing := await prior_job(files, project_id, body.request_id, payload):
        return existing
    current = await files.projects.story(project_id)
    if current.revision != body.expected_story_revision:
        raise ProjectResourceError("故事版本已变化", "story_revision_conflict", 409)
    task = GalgameAnnotationImportTask(
        owner_user_id=owner,
        project_id=project_id,
        source_project_id=body.source_project_id,
        request_id=body.request_id,
        expected_source_revision=body.expected_source_revision,
        expected_story_revision=body.expected_story_revision,
        request_payload=payload,
        result_detail={"phase": "queued"},
    )
    db.add(task)
    await db.flush()
    db.add(
        GalgameAnnotationAuthorization(
            task_id=task.id, owner_user_id=owner, assertion=files.assertion
        )
    )
    result = annotation_task_out(task)
    await db.commit()
    return result
