"""Accept only a live Galgame import grant for an Annotation source snapshot."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from studio.apps.audio_annotation.storage.galgame_source import read_source
from studio.contracts.galgame_workshop.galgame_annotation_source import (
    ANNOTATION_PATH,
    AnnotationSource,
    annotation_target,
)
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.runtime.project_errors import ProjectResourceError

router = APIRouter(include_in_schema=False)


@router.get(ANNOTATION_PATH + "/{galgame_project_id}/{source_id}", response_model=AnnotationSource)
async def get_source(request: Request, source_id: str):
    path = request.url.path
    if (
        not annotation_target("GET", path)
        or "origin" in request.headers
        or "cookie" in request.headers
    ):
        raise HTTPException(403, "galgame_annotation_grant_required")
    token = request.headers.get(HEADER, "")
    state = request.app.state
    try:
        actor = verify_context(
            token,
            service="annotation",
            method="GET",
            path=path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "galgame_annotation_grant_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "galgame_annotation_forbidden")
    active = await state.identity.status(assertion=token, method="GET", path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "galgame_annotation_authority_ended")
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        try:
            return await read_source(session, actor.user_id, source_id)
        except ProjectResourceError as exc:
            raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
