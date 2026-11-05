"""Only configured application publishers can invalidate an account's browser caches."""

import secrets
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .changes import receive

router = APIRouter()


class ChangeEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: str = Field(min_length=1, max_length=64)
    event_id: UUID
    owner_user_id: str = Field(min_length=1, max_length=100)


@router.post("/_internal/v1/change-events")
async def change_event(request: Request, body: ChangeEvent):
    expected = request.app.state.publishers.get(body.service)
    credential = request.headers.get("authorization", "").removeprefix("Bearer ")
    if expected is None or not secrets.compare_digest(expected, credential):
        raise HTTPException(403, "publisher_credential_required")
    value = await receive(
        request.app.state.database,
        service=body.service,
        event_id=str(body.event_id),
        owner=body.owner_user_id,
    )
    return {"acknowledged": True, "revision": value}
