"""Read an exact completed Video segment bundle through Identity delegation."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from studio.apps.asset_library.video.video_segment_bundles import build_bundle
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.video_editor.video_segments import BUNDLES, bundle_target

router = APIRouter(include_in_schema=False)


@router.get(BUNDLES + "/{project_id}/{task_id}")
async def bundle(request: Request, project_id: str, task_id: str):
    state, path = request.app.state, request.url.path
    if "origin" in request.headers or "cookie" in request.headers or not bundle_target("GET", path):
        raise HTTPException(403, "private_video_segment_bundle_required")
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token, service="assets", method="GET", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, "video_segment_bundle_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "video_segment_bundle_authorization_forbidden")

    async def active():
        status = await state.identity.status(assertion=token, method="GET", path=path)
        if status is not True:
            raise HTTPException(
                503 if status is None else 403,
                "identity_unavailable" if status is None else "authorization_revoked",
            )

    await active()
    archive = await build_bundle(state.database, state.settings, actor.user_id, project_id, task_id)
    try:
        await active()
    except BaseException:
        archive.unlink(missing_ok=True)
        raise
    return FileResponse(
        archive,
        media_type="application/zip",
        filename=f"segments-{task_id[:8]}.zip",
        headers={"Cache-Control": "no-store"},
        background=BackgroundTask(archive.unlink, missing_ok=True),
    )
