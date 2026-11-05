"""Record owned ASR jobs against the selected model and exact original revisions."""

from sqlalchemy import select, text

from app.apps.galgame_workshop.assets.asr_records import transcription_task_out
from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameAssetTranscriptionTask,
)
from app.apps.galgame_workshop.schemas import GalgameTranscriptionTaskListOut
from fpl_runtime.project_errors import ProjectResourceError

from .asr_dispatch import catalog_entry
from .models import GalgameAsrDispatch


async def enqueue_transcriptions(files, project, body):
    db, owner = files.session, files.projects.owner
    await files.projects.row(project)
    settings = await db.get(GalgameAssetSettings, project)
    if settings is None or not settings.asr_model_id:
        raise ProjectResourceError("语音识别模型尚未就绪", "asr_model_unavailable", 422)
    model_id, settings_revision = settings.asr_model_id, settings.revision
    language = body.language or settings.default_language
    await db.rollback()
    model = await catalog_entry(files.capabilities, files.assertion, project, model_id)
    if model is None:
        raise ProjectResourceError("语音识别模型尚未就绪", "asr_model_unavailable", 422)
    requested = set(body.asset_ids) if body.asset_ids is not None else None
    assets = sorted(
        (
            asset
            for asset, _ in await files.asset_records(project, (), newest_first=False)
            if asset.media_kind == "audio" and (requested is None or asset.id in requested)
        ),
        key=lambda asset: (asset.display_name, asset.id),
    )
    await db.rollback()
    await db.execute(text("BEGIN IMMEDIATE"))
    await files.projects.row(project)
    current = await db.get(GalgameAssetSettings, project)
    if current is None or current.revision != settings_revision:
        raise ProjectResourceError("语音识别设置已变化", "asr_settings_changed", 409)
    asset_ids = {asset.id for asset in assets}
    metadata = {
        row.asset_id: row
        for row in await db.scalars(
            select(GalgameAssetMetadata).where(
                GalgameAssetMetadata.project_id == project,
                GalgameAssetMetadata.asset_id.in_(asset_ids),
                GalgameAssetMetadata.category == "voice",
            )
        )
    }
    active = {
        row.asset_id: row
        for row in await db.scalars(
            select(GalgameAssetTranscriptionTask)
            .join(
                GalgameAsrDispatch, GalgameAsrDispatch.task_id == GalgameAssetTranscriptionTask.id
            )
            .where(
                GalgameAssetTranscriptionTask.project_id == project,
                GalgameAssetTranscriptionTask.asset_id.in_(asset_ids),
                GalgameAssetTranscriptionTask.status.in_(("queued", "running")),
            )
        )
    }
    tasks, dispatches = [], []
    for asset in assets:
        asset_meta = metadata.get(asset.id)
        if asset_meta is None or (not body.force and asset_meta.transcript_status == "ready"):
            continue
        if prior := active.get(asset.id):
            if (prior.model_id, prior.language, prior.force) != (model_id, language, body.force):
                raise ProjectResourceError("同一素材已有不同设置的识别任务", "asr_asset_busy", 409)
            tasks.append(prior)
            continue
        task = GalgameAssetTranscriptionTask(
            owner_user_id=owner,
            project_id=project,
            asset_id=asset.id,
            provider_id=model.provider_id,
            provider_name=model.provider_name,
            model_id=model_id,
            model_slug=model.model_slug,
            language=language,
            force=body.force,
        )
        asset_meta.transcript_status = "queued"
        db.add(task)
        tasks.append(task)
        dispatches.append((task, asset, asset_meta.transcript_revision))
    await db.flush()
    db.add_all(
        GalgameAsrDispatch(
            task_id=task.id,
            owner_user_id=owner,
            assertion=files.assertion,
            asset_revision=asset.revision,
            transcript_revision=revision,
            byte_limit=model.byte_limit,
        )
        for task, asset, revision in dispatches
    )
    result = GalgameTranscriptionTaskListOut(items=[transcription_task_out(task) for task in tasks])
    await db.commit()
    return result
