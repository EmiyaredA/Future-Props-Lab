"""The Models subscriber alone can poll and acknowledge catalogue initialization work."""

import secrets
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from starlette.responses import JSONResponse

from fpl_runtime.catalog_events import (
    AcknowledgeCatalogEvent,
    CatalogAcknowledgment,
    CatalogDelivery,
    CatalogEvents,
    EventId,
)

from .accounts import acknowledge_catalog_event, pending_catalog_events


def require_models(request: Request):
    credentials = request.app.state.identity_options["service_credentials"]
    expected = credentials.get("models")
    raw = request.headers.get("authorization", "")
    actual = raw[7:] if raw.startswith("Bearer ") else ""
    if (
        "origin" in request.headers
        or "cookie" in request.headers
        or not isinstance(expected, str)
        or len(expected) < 32
        or any(token == expected for service, token in credentials.items() if service != "models")
        or not secrets.compare_digest(actual.encode(), expected.encode())
    ):
        raise HTTPException(403, {"code": "model_catalog_credential_required"})


router = APIRouter(
    prefix="/_internal/v1/model-catalog/events",
    include_in_schema=False,
    dependencies=[Depends(require_models)],
)


@router.get("")
async def pending(request: Request, limit: Annotated[int, Query(ge=1, le=100)] = 100):
    async with request.app.state.database.sessions() as session:
        rows = await pending_catalog_events(session, limit=limit)
    expiry = int(time.time()) + 20
    result = CatalogEvents(
        events=tuple(CatalogDelivery.model_validate({**row, "expires_at": expiry}) for row in rows)
    )
    return JSONResponse(result.model_dump(mode="json"), headers={"Cache-Control": "no-store"})


@router.post("/{event_id}/ack")
async def acknowledge(
    request: Request, event_id: Annotated[EventId, Path()], body: AcknowledgeCatalogEvent
):
    async with request.app.state.database.sessions() as session:
        accepted = await acknowledge_catalog_event(session, event_id, body.revision)
    if not accepted:
        raise HTTPException(409, {"code": "catalog_event_revision_conflict"})
    result = CatalogAcknowledgment(id=event_id, revision=body.revision + 1, acknowledged=True)
    return JSONResponse(result.model_dump(mode="json"), headers={"Cache-Control": "no-store"})
