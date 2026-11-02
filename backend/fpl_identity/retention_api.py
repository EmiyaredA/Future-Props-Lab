"""Private retention authorization. These operations never enter public OpenAPI."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from fpl_runtime.retention_authority import RetentionRequest

from .retention import RetentionAuthorization

router = APIRouter(prefix="/_internal/v1/asset-retention", include_in_schema=False)


def bearer(request):
    value = request.headers.get("authorization", "")
    return value[7:] if value.startswith("Bearer ") else ""


class CheckRetention(BaseModel):
    model_config = ConfigDict(extra="forbid")
    authority: str = Field(min_length=1, max_length=16384)


@router.post("/authorize")
async def authorize(request: Request, body: RetentionRequest):
    token = await RetentionAuthorization(request.app.state).issue(body, bearer(request))
    return JSONResponse({"authority": token}, headers={"Cache-Control": "no-store"})


@router.post("/check")
async def check(request: Request, body: CheckRetention):
    active = await RetentionAuthorization(request.app.state).can_prepare(
        body.authority, bearer(request)
    )
    return JSONResponse({"active": active}, headers={"Cache-Control": "no-store"})
