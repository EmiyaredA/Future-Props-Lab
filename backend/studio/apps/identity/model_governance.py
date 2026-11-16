"""Models may inspect template targets only under an original administrator request."""

import re
import time

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from studio.apps.identity.storage.account_directory import template_targets as read_template_targets
from studio.apps.identity.storage.actor_status import active_actor
from studio.contracts.identity.claims import verify_context

from .catalog_events import require_models

router = APIRouter(
    prefix="/_internal/v1/model-governance",
    include_in_schema=False,
    dependencies=[Depends(require_models)],
)


class TemplateTargets(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assertion: str = Field(min_length=1, max_length=8192)
    path: str = Field(min_length=1, max_length=4096)
    role: str = Field(pattern="^(admin|user)$")
    account_ids: list[str] | None = Field(default=None, min_length=1, max_length=1000)


@router.post("/template-targets")
async def template_targets(request: Request, body: TemplateTargets):
    preview = body.path == f"/v1/platform/model-service-templates/{body.role}/preview"
    starting = re.fullmatch(
        r"/v1/platform/model-service-templates/sync-jobs/[^/]{1,100}/start", body.path
    )
    operation = request.app.state.service_catalog.match("POST", body.path)
    if not (preview or starting) or operation is None or operation.service != "models":
        raise HTTPException(403, {"code": "model_template_target_forbidden"})
    try:
        actor = verify_context(
            body.assertion,
            service="models",
            method="POST",
            path=body.path,
            public_key=request.app.state.identity_options["private_key"].public_key(),
            allow_expired=True,
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, {"code": "studio_auth_required"}) from None
    if actor.auth_kind != "session" or actor.platform_role != "admin":
        raise HTTPException(403, {"code": "platform_admin_required"})
    async with request.app.state.database.sessions() as session:
        active = await active_actor(session, actor)
        targets = []
        if active:
            targets = await read_template_targets(session, body.role, body.account_ids)
            if len(targets) > 1000:
                raise HTTPException(413, {"code": "template_targets_too_large"})
    return JSONResponse(
        {"active": bool(active), "expires_at": int(time.time()) + 5, "targets": targets},
        headers={"Cache-Control": "no-store"},
    )
