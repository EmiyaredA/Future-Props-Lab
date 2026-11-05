"""Private retention authorization. These operations never enter public OpenAPI."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from fpl_runtime.claims import HEADER
from fpl_runtime.retention_authority import RetentionRequest
from fpl_runtime.visual_generation_approval import (
    ApprovedGenerationPublication,
    GenerationApproval,
)

from .retention import RetentionAuthorization, require_credential
from .visual_generation_approval import authorize_publication, reserve

router = APIRouter(prefix="/_internal/v1/asset-retention", include_in_schema=False)


def bearer(request):
    value = request.headers.get("authorization", "")
    return value[7:] if value.startswith("Bearer ") else ""


class CheckRetention(BaseModel):
    model_config = ConfigDict(extra="forbid")
    authority: str = Field(min_length=1, max_length=16384)
    sealed_visual_upload: bool = False


@router.post("/authorize")
async def authorize(request: Request, body: RetentionRequest):
    token = await RetentionAuthorization(request.app.state).issue(body, bearer(request))
    return JSONResponse({"authority": token}, headers={"Cache-Control": "no-store"})


@router.post("/check")
async def check(request: Request, body: CheckRetention):
    active = await RetentionAuthorization(request.app.state).can_prepare(
        body.authority, bearer(request), sealed_visual_upload=body.sealed_visual_upload
    )
    return JSONResponse({"active": active}, headers={"Cache-Control": "no-store"})


@router.post("/visual-generation/admit")
async def admit_generation(request: Request, body: GenerationApproval):
    require_credential(request.app.state.identity_options, "visual", bearer(request))
    return await reserve(request.app.state, body, request.headers.get(HEADER, ""))


@router.post("/visual-generation/publish")
async def publish_generation(request: Request, body: ApprovedGenerationPublication):
    require_credential(request.app.state.identity_options, "visual", bearer(request))
    token = await authorize_publication(request.app.state, body)
    return JSONResponse({"authority": token}, headers={"Cache-Control": "no-store"})
