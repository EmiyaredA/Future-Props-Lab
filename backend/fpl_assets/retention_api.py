"""Private retention protocol; no chosen owner and no general service impersonation."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.retention_authority import verify_retention

router = APIRouter(prefix="/_internal/v1/retention", include_in_schema=False)


class CommitReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resource_revision: int = Field(ge=0, strict=True)
    deleted: bool = Field(default=False, strict=True)


def authority(request):
    value = request.headers.get("authorization", "")
    token = value[7:] if value.startswith("Bearer ") else ""
    if not 1 <= len(token) <= 16384:
        raise HTTPException(401, {"code": "retention_authority_required"})
    try:
        result = verify_retention(token, public_key=request.app.state.identity_public_key)
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError) as exc:
        raise HTTPException(401, {"code": "invalid_retention_authority"}) from exc
    return result, token


def private_result(value):
    return JSONResponse(value, headers={"Cache-Control": "no-store"})


@router.post("/prepare")
async def prepare(request: Request, body: PrepareReferenceChange):
    grant, token = authority(request)
    try:
        matches = grant.matches(body)
    except ValueError:
        matches = False
    if not matches:
        raise HTTPException(403, {"code": "retention_change_not_authorized"})
    changes = request.app.state.reference_changes
    existing = await changes.replay(authority=grant)
    if existing is not None:
        return private_result(existing)
    active = await request.app.state.identity.can_prepare_retention(token)
    if active is None:
        raise HTTPException(503, {"code": "retention_authorization_unavailable"})
    if not active:
        raise HTTPException(403, {"code": "retention_preparation_denied"})
    return private_result(
        await changes.prepare(
            owner=grant.owner_id,
            service=grant.caller,
            change=body,
            not_after=grant.prepare_before,
            community=grant.community,
        )
    )


async def checked_intent(request, intent_id):
    grant, _token = authority(request)
    changes = request.app.state.reference_changes
    await changes.verify_access(authority=grant, intent_id=intent_id)
    return (
        changes,
        grant,
        {
            "owner": grant.owner_id,
            "service": grant.caller,
            "intent_id": intent_id,
        },
    )


@router.get("/intents/{intent_id}")
async def status(request: Request, intent_id: str):
    changes, _grant, arguments = await checked_intent(request, intent_id)
    return private_result(await changes.status(**arguments))


@router.post("/intents/{intent_id}/commit")
async def commit(request: Request, intent_id: str, body: CommitReference):
    changes, grant, arguments = await checked_intent(request, intent_id)
    if grant.community and (
        body.deleted or body.resource_revision != grant.community.note_revision + 1
    ):
        raise HTTPException(403, {"code": "retention_community_outcome_mismatch"})
    return private_result(await changes.commit(**arguments, **body.model_dump()))


@router.post("/intents/{intent_id}/abort")
async def abort(request: Request, intent_id: str):
    changes, _grant, arguments = await checked_intent(request, intent_id)
    return private_result(await changes.abort(**arguments))
