import shutil
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.apps.thought_workshop.content_exports import convert, export_note
from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.schemas.conversion import ThoughtMarkdownIn, ThoughtMarkdownOut
from app.deps import SessionDep, WorkspaceDep

router = APIRouter(prefix="/thought-workshop", tags=["thought-workshop"])


async def call(operation):
    try:
        return await operation
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/markdown/convert", response_model=ThoughtMarkdownOut)
async def convert_markdown(
    body: ThoughtMarkdownIn, session: SessionDep, workspace_id: WorkspaceDep
):
    return await call(convert(session, workspace_id, body))


@router.get(
    "/notes/{note_id}/export",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
async def export_note_content(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    note_id: str,
    expected_revision: int = Query(ge=0),
    format: Literal["md", "html"] = "md",
):
    path = await call(export_note(session, workspace_id, note_id, expected_revision, format))
    return FileResponse(
        path,
        filename=path.name,
        background=BackgroundTask(shutil.rmtree, path.parent, ignore_errors=True),
    )
