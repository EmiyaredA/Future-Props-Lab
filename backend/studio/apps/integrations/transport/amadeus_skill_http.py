"""Serve only exact, live Amadeus delegations for one account's enabled Skill."""

import jwt
from anyio.to_thread import run_sync
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.integrations.common import IntegrationNotFoundError
from studio.apps.integrations.amadeus_skill_archive import snapshot
from studio.contracts.amadeus.amadeus_skills import HEADER as SKILL_HEADER
from studio.contracts.amadeus.amadeus_skills import SKILL_SOURCE, pin_target
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.runtime.database.operation_receipts import OperationError

router = APIRouter(include_in_schema=False)


@router.get(SKILL_SOURCE + "/{skill_id}/{kind}")
async def source(request: Request, skill_id: str, kind: str):
    path = request.url.path
    if (
        request.headers.get("origin")
        or request.headers.get("cookie")
        or not pin_target("GET", path)
    ):
        raise HTTPException(403, "skill_pin_forbidden")
    state = request.app.state
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token,
            service="integrations",
            method="GET",
            path=path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "skill_pin_forbidden") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "skill_pin_forbidden")

    async def check_live():
        status = await state.identity.status(assertion=token, method="GET", path=path)
        if status is not True:
            raise HTTPException(503 if status is None else 403, "skill_pin_not_authorized")

    await check_live()
    try:
        result = await snapshot(
            state.database,
            state.settings,
            actor.user_id,
            skill_id,
            include_archive=kind == "archive",
        )
    except IntegrationNotFoundError as exc:
        raise HTTPException(404, {"code": "not_found", "message": "Skill 不存在"}) from exc
    except OperationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(
            409, {"code": "skill_unavailable", "message": "Skill 文件不可用"}
        ) from exc
    if kind == "metadata":
        return result
    try:
        await check_live()
    except BaseException:
        result.file.close()
        raise

    async def chunks():
        try:
            while data := await run_sync(result.file.read, 1024 * 1024):
                yield data
        finally:
            result.file.close()

    return StreamingResponse(
        chunks(),
        media_type="application/zip",
        headers={
            SKILL_HEADER: result.pin.header(),
            "Content-Length": str(result.pin.archive_bytes),
        },
        background=BackgroundTask(result.file.close),
    )
