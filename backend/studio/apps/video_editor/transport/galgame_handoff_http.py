"""Receive the same Galgame handoff as one durable Video project."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from studio.apps.video_editor.storage.galgame_handoff_records import handoff_status
from studio.contracts.galgame_workshop.galgame_handoff import (
    VIDEO_ARCHIVE_HEADER,
    VIDEO_ARCHIVE_SOURCE,
    VIDEO_TARGET,
    VideoHandoffReceipt,
    video_target,
)
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.runtime.files.project_archives import ProjectSnapshotError

router = APIRouter(include_in_schema=False)


class IncomingArchive:
    def __init__(self, request):
        self.chunks = aiter(request.stream())

    async def read(self, _size):
        return await anext(self.chunks, b"")

    async def close(self):
        await self.chunks.aclose()


async def actor(request):
    if (
        "origin" in request.headers
        or "cookie" in request.headers
        or not video_target(request.method, request.url.path)
    ):
        raise HTTPException(403, "private_galgame_handoff_required")
    state = request.app.state
    token = request.headers.get(HEADER, "")
    archive = request.headers.get(VIDEO_ARCHIVE_HEADER, "")
    try:
        principal = verify_context(
            token,
            service="video",
            method=request.method,
            path=request.url.path,
            public_key=state.identity_public_key,
            allow_expired=request.method == "GET",
        )
        if request.method == "POST":
            source_actor = verify_context(
                archive,
                service="video",
                method="POST",
                path=VIDEO_ARCHIVE_SOURCE,
                public_key=state.identity_public_key,
            )
            if source_actor != principal:
                raise HTTPException(403, "galgame_handoff_actor_changed")
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "galgame_handoff_grant_required") from None
    if principal.purpose != "studio" or "content.write" not in effective_permissions(
        principal.platform_role, frozenset(principal.scopes)
    ):
        raise HTTPException(403, "galgame_handoff_forbidden")
    # An exact, previously issued receipt query can settle a committed handoff after logout.
    if request.method == "POST":
        active = await state.handoff_identity.status(
            assertion=token, method=request.method, path=request.url.path
        )
        if active is not True:
            raise HTTPException(401 if active is False else 503, "galgame_handoff_authority_ended")
    return principal, archive


@router.get(
    VIDEO_TARGET + "/{source_project}/{task_id}/{digest}", response_model=VideoHandoffReceipt
)
async def get_handoff(request: Request, source_project: str, task_id: str, digest: str):
    principal, _ = await actor(request)
    state = request.app.state
    try:
        async with state.database.sessions(info={"owner_user_id": principal.user_id}) as session:
            receipt = await handoff_status(session, source_project, task_id, digest)
    except ProjectSnapshotError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    if receipt is None:
        raise HTTPException(404, "galgame_handoff_not_found")
    return receipt


@router.post(
    VIDEO_TARGET + "/{source_project}/{task_id}/{digest}", response_model=VideoHandoffReceipt
)
async def receive_handoff(request: Request, source_project: str, task_id: str, digest: str):
    principal, archive_token = await actor(request)
    state = request.app.state
    imports = state.video_snapshot_imports
    if imports is None:
        raise HTTPException(503, "galgame_handoff_archive_unavailable")
    if (
        request.headers.get("Content-Type") != "application/zip"
        or request.headers.get("Content-Encoding", "identity") != "identity"
    ):
        raise HTTPException(422, "galgame_handoff_archive_type_invalid")
    try:
        async with state.database.sessions(info={"owner_user_id": principal.user_id}) as session:
            current = await handoff_status(session, source_project, task_id, digest)
            if current is not None:
                return current
            result = await imports.run(
                session,
                principal.user_id,
                IncomingArchive(request),
                archive_token,
                handoff=(source_project, task_id, digest),
            )
            return VideoHandoffReceipt(state="published", project_id=result.project.id)
    except ProjectSnapshotError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
