"""Open the verified project folder using the original local browser authority."""

from fastapi import APIRouter, Request

from studio.apps.asset_library.clients.project_reveal_http import (
    open_verified_project_folder,
    require_local_project_request,
)
from studio.apps.video_editor.errors import VideoEditorNotFoundError
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.transport.website.errors import _error
from studio.assembly.http_dependencies import SessionDep, StudioAuth
from studio.contracts.asset_library.project_snapshots import ProjectFolderOpenOut

router = APIRouter()


@router.post("/projects/{project_id}/open-folder", response_model=ProjectFolderOpenOut)
async def reveal_project_folder(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    project_id: str,
) -> ProjectFolderOpenOut:
    require_local_project_request(request, principal)
    try:
        await VideoEditorProjects(session, principal.user_id).row(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None
    return await open_verified_project_folder(request, session, "video-editor", project_id)
