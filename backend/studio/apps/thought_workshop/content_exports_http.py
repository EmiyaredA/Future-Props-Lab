"""HTTP routes for the shared Thought conversion and export use cases."""

import shutil
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from studio.apps.thought_workshop.content_exports import convert, export_note
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.http_bindings import SessionDep
from studio.apps.thought_workshop.schemas.conversion import ThoughtMarkdownIn, ThoughtMarkdownOut
from studio.assembly.http_dependencies import OwnerDep

router = APIRouter(prefix="/thought-workshop", tags=["thought-workshop"])


async def call(operation):
    try:
        return await operation
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/markdown/convert", response_model=ThoughtMarkdownOut)
async def convert_markdown(body: ThoughtMarkdownIn, session: SessionDep, owner_user_id: OwnerDep):
    return await call(convert(session, owner_user_id, body))


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
    owner_user_id: OwnerDep,
    note_id: str,
    expected_revision: int = Query(ge=0),
    format: Literal["md", "html"] = "md",
):
    path = await call(export_note(session, owner_user_id, note_id, expected_revision, format))
    return FileResponse(
        path,
        filename=path.name,
        background=BackgroundTask(shutil.rmtree, path.parent, ignore_errors=True),
    )
