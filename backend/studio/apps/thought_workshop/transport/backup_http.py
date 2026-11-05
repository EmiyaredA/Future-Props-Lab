"""Serve a private Thought backup with response-scoped file cleanup."""

import shutil

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from studio.apps.thought_workshop.archives.backup import export_backup
from studio.apps.thought_workshop.http_bindings import SessionDep
from studio.apps.thought_workshop.transport.mutations_http import guarded
from studio.assembly.http_dependencies import OwnerDep

router = APIRouter(prefix="/thought-workshop", tags=["thought-workshop"])


@router.get("/backup", response_class=FileResponse)
async def backup(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    knowledge_base_id: str | None = None,
):
    path = await guarded(
        export_backup(
            session, owner_user_id, knowledge_base_id, request.app.state.thought_backup_limits
        )
    )
    return FileResponse(
        path,
        filename="thought-workshop.zip",
        media_type="application/zip",
        background=BackgroundTask(shutil.rmtree, path.parent, ignore_errors=True),
    )
