"""Publish account-owned Video task queries in both site assemblies."""

from fastapi import APIRouter

from studio.apps.video_editor.errors import VideoEditorNotFoundError
from studio.apps.video_editor.schemas import VideoEditorTaskListOut, VideoEditorTaskOut
from studio.apps.video_editor.task_reads import VideoTaskReads
from studio.apps.video_editor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter()


@router.get("/projects/{project_id}/asset-bakes/{task_id}", response_model=VideoEditorTaskOut)
async def get_asset_bake(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoTaskReads(session, owner_user_id).get(
            project_id, task_id, kind="asset_bake", missing="烘焙任务不存在"
        )
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/renders", response_model=VideoEditorTaskListOut)
async def list_renders(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> VideoEditorTaskListOut:
    try:
        return await VideoTaskReads(session, owner_user_id).list(project_id, "render")
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/renders/{task_id}", response_model=VideoEditorTaskOut)
async def get_render(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoTaskReads(session, owner_user_id).get(
            project_id, task_id, kind=None, missing="渲染任务不存在"
        )
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/segment-exports", response_model=VideoEditorTaskListOut)
async def list_segment_exports(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> VideoEditorTaskListOut:
    try:
        return await VideoTaskReads(session, owner_user_id).list(project_id, "segment_export")
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get(
    "/projects/{project_id}/segment-exports/{task_id}",
    response_model=VideoEditorTaskOut,
)
async def get_segment_export(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoTaskReads(session, owner_user_id).get(
            project_id, task_id, kind="segment_export", missing="分段导出任务不存在"
        )
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/clip-merges", response_model=VideoEditorTaskListOut)
async def list_clip_merges(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> VideoEditorTaskListOut:
    try:
        return await VideoTaskReads(session, owner_user_id).list(project_id, "clip_merge")
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/clip-merges/{task_id}", response_model=VideoEditorTaskOut)
async def get_clip_merge(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, task_id: str
) -> VideoEditorTaskOut:
    try:
        return await VideoTaskReads(session, owner_user_id).get(
            project_id, task_id, kind="clip_merge", missing="合并任务不存在"
        )
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None
