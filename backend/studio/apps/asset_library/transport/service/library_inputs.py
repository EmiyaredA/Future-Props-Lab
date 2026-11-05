"""Private, request-bound file input protocol, excluded from the public gateway and SDK."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from studio.apps.asset_library.library_inputs import LibraryInputFiles
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions

router = APIRouter(include_in_schema=False)


@router.get("/_internal/v1/model-library-inputs/{asset_id}")
async def library_input(request: Request, asset_id: str):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "private_file_input_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method="GET",
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "file_input_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "file_input_authorization_forbidden")
    async with request.app.state.database.sessions(
        info={"owner_user_id": actor.user_id}
    ) as session:
        description, path = await LibraryInputFiles(
            session, request.app.state.settings, actor.user_id
        ).get(asset_id)
        await session.rollback()
    return FileResponse(
        path,
        media_type=description.mime_type,
        filename=description.filename,
        content_disposition_type="inline",
        headers={
            "X-Content-Type-Options": "nosniff",
            "X-Fpl-File-Kind": description.media_kind,
            "X-Fpl-File-Revision": str(description.revision),
        },
    )
