"""Published Galgame annotation, video export and editor handoff records."""

from fastapi import APIRouter, Request

from app.apps.galgame_workshop.schemas import (
    GalgameAnnotationImportTaskOut,
    GalgameVideoEditorHandoffTaskListOut,
    GalgameVideoEditorHandoffTaskOut,
    GalgameVideoExportPreviewIn,
    GalgameVideoExportPreviewOut,
    GalgameVideoExportTaskListOut,
    GalgameVideoExportTaskOut,
)
from fpl_runtime.galgame_assets import SOURCE
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from .asset_read_routes import read_assets
from .export_download import download_export
from .export_preflight import export_preview
from .task_records import TaskRecords

router = APIRouter(prefix=SOURCE, tags=["galgame-workshop"])


@router.get(
    "/{project_id}/annotation-imports/{import_id}", response_model=GalgameAnnotationImportTaskOut
)
async def get_annotation_import(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, import_id: str
) -> GalgameAnnotationImportTaskOut:
    return await TaskRecords(session, owner_user_id).annotation_import(project_id, import_id)


@router.post("/{project_id}/video-exports/preview", response_model=GalgameVideoExportPreviewOut)
async def preview_video_export(
    session: SessionDep,
    project_id: str,
    body: GalgameVideoExportPreviewIn,
    request: Request,
    owner_user_id: OwnerDep,
) -> GalgameVideoExportPreviewOut:
    return await export_preview(
        request, read_assets(request, session, owner_user_id), project_id, body
    )


@router.get("/{project_id}/video-exports", response_model=GalgameVideoExportTaskListOut)
async def list_video_exports(
    session: SessionDep, project_id: str, owner_user_id: OwnerDep
) -> GalgameVideoExportTaskListOut:
    return await TaskRecords(session, owner_user_id).list_exports(project_id)


@router.get("/{project_id}/video-exports/{export_id}", response_model=GalgameVideoExportTaskOut)
async def get_video_export(
    session: SessionDep, project_id: str, export_id: str, owner_user_id: OwnerDep
) -> GalgameVideoExportTaskOut:
    return await TaskRecords(session, owner_user_id).export(project_id, export_id)


@router.post(
    "/{project_id}/video-exports/{export_id}/cancel", response_model=GalgameVideoExportTaskOut
)
async def cancel_video_export(
    session: SessionDep, project_id: str, export_id: str, owner_user_id: OwnerDep
) -> GalgameVideoExportTaskOut:
    return await TaskRecords(session, owner_user_id).cancel_export(project_id, export_id)


@router.get(
    "/{project_id}/video-editor-handoffs", response_model=GalgameVideoEditorHandoffTaskListOut
)
async def list_handoffs(
    session: SessionDep, project_id: str, owner_user_id: OwnerDep
) -> GalgameVideoEditorHandoffTaskListOut:
    return await TaskRecords(session, owner_user_id).list_handoffs(project_id)


@router.get(
    "/{project_id}/video-editor-handoffs/{task_id}", response_model=GalgameVideoEditorHandoffTaskOut
)
async def get_handoff(
    session: SessionDep, project_id: str, task_id: str, owner_user_id: OwnerDep
) -> GalgameVideoEditorHandoffTaskOut:
    return await TaskRecords(session, owner_user_id).handoff(project_id, task_id)


@router.post(
    "/{project_id}/video-editor-handoffs/{task_id}/cancel",
    response_model=GalgameVideoEditorHandoffTaskOut,
)
async def cancel_handoff(
    session: SessionDep, project_id: str, task_id: str, owner_user_id: OwnerDep
) -> GalgameVideoEditorHandoffTaskOut:
    return await TaskRecords(session, owner_user_id).cancel_handoff(project_id, task_id)


@router.get("/{project_id}/video-exports/{export_id}/download")
async def download_video_export(
    session: SessionDep, project_id: str, export_id: str, request: Request, owner_user_id: OwnerDep
):
    return await download_export(request, session, owner_user_id, project_id, export_id)
