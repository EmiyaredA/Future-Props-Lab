"""Preserve Amadeus working-file URLs while using only its own state volume."""

import asyncio
from functools import partial
from urllib.parse import quote

from anyio.to_thread import run_sync
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask

from app.console.amadeus.conversations import Conversations
from app.console.amadeus.files import import_work_file, list_files, open_work_file, write_file
from app.console.amadeus.schemas import FileListOut, FileOut, FileWriteIn
from fpl_runtime.http_dependencies import SessionDep, StudioAuth

router = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])


@router.get("/conversations/{conversation_id}/files", response_model=FileListOut)
async def files_list(
    request: Request, session: SessionDep, principal: StudioAuth, conversation_id: str
) -> FileListOut:
    await Conversations(session, principal)._get(conversation_id)
    await session.rollback()
    root = request.app.state.database.root
    rows = await run_sync(partial(list_files, principal.user_id, conversation_id, files_root=root))
    return FileListOut(items=rows)


@router.get("/conversations/{conversation_id}/files/{kind}/{name}", response_class=Response)
async def file_download(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    kind: str,
    name: str,
) -> Response:
    await Conversations(session, principal)._get(conversation_id)
    await session.rollback()
    file, size = await run_sync(
        partial(
            open_work_file,
            principal.user_id,
            conversation_id,
            kind,
            name,
            files_root=request.app.state.database.root,
        )
    )

    async def stream():
        try:
            while data := await run_sync(file.read, 1024 * 1024):
                yield data
        finally:
            file.close()

    return StreamingResponse(
        stream(),
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
            "Content-Length": str(size),
        },
        background=BackgroundTask(file.close),
    )


@router.put("/conversations/{conversation_id}/files/{kind}/{name}", response_model=FileOut)
async def file_write(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    kind: str,
    name: str,
    body: FileWriteIn,
) -> FileOut:
    app = request.app.state
    async with app.file_locks.setdefault((principal.user_id, conversation_id), asyncio.Lock()):
        await Conversations(session, principal)._get(conversation_id)
        await session.rollback()
        result = await run_sync(
            partial(
                write_file,
                principal.user_id,
                conversation_id,
                kind,
                name,
                body.content.encode(),
                body.expected_sha256,
                files_root=app.database.root,
            )
        )
    return FileOut(**result)


@router.post("/conversations/{conversation_id}/imports", response_model=FileOut)
async def import_file(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    upload: UploadFile = File(...),
) -> FileOut:
    app = request.app.state
    try:
        async with app.file_locks.setdefault((principal.user_id, conversation_id), asyncio.Lock()):
            await Conversations(session, principal)._get(conversation_id)
            await session.rollback()
            result = await import_work_file(
                principal.user_id, conversation_id, upload, files_root=app.database.root
            )
        return FileOut(**result)
    finally:
        await upload.close()
