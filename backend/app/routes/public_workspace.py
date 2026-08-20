from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.accounts.public_workspace import (
    public_asset_content,
    public_projection,
    public_story,
)
from app.accounts.service import AccountError
from app.deps import PublicStudioAuth, SessionDep
from app.schemas.public_workspace import (
    PublicGalgameStoryOut,
    PublicWorkspaceProjectionOut,
)

router = APIRouter(prefix="/public-workspace", tags=["public-workspace"])


def _not_found(exc: AccountError):
    raise HTTPException(404, detail={"code": exc.code}) from exc


@router.get("", response_model=PublicWorkspaceProjectionOut)
async def projection(session: SessionDep, auth: PublicStudioAuth):
    try:
        return PublicWorkspaceProjectionOut(**await public_projection(session, auth.workspace_id))
    except AccountError as exc:
        _not_found(exc)


@router.get("/galgame-projects/{project_id}/story", response_model=PublicGalgameStoryOut)
async def story(project_id: str, session: SessionDep, auth: PublicStudioAuth):
    try:
        row = await public_story(session, workspace_id=auth.workspace_id, project_id=project_id)
    except AccountError as exc:
        _not_found(exc)
    return PublicGalgameStoryOut(
        project_id=row.project_id, revision=row.revision, document=row.document
    )


@router.get("/assets/{asset_id}/content")
async def asset_content(asset_id: str, session: SessionDep, auth: PublicStudioAuth):
    try:
        asset, path = await public_asset_content(
            session, workspace_id=auth.workspace_id, asset_id=asset_id
        )
    except AccountError as exc:
        _not_found(exc)
    return FileResponse(
        path,
        media_type=asset.mime_type,
        filename=None,
        headers={"Content-Disposition": "inline", "Cache-Control": "private, max-age=300"},
    )
