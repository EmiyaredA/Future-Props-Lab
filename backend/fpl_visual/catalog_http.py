"""Keep public Visual catalog routes while Models supplies account-specific options."""

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from app.apps.visual_workshop.acceptance.http_errors import errors
from app.apps.visual_workshop.acceptance.project_access import project
from app.deps import OwnerDep, SessionDep, require_studio_auth
from app.llm.schemas.visual_catalog import AcceptanceModelListOut, GenerationOptionsOut
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.visual_catalog import (
    ACCEPTANCE_TARGET,
    GENERATION_SOURCE,
    GENERATION_TARGET,
    PURPOSE,
)

generation = APIRouter(tags=["visual-generation"])
acceptance = APIRouter(tags=["visual-workshop"])


async def lookup(request, target, schema):
    client = request.app.state.capabilities
    grant = RequestGrant("visual", PURPOSE, "GET", request.url.path, "models", "GET", target)
    try:
        token = await client.authorize_request(request.state.service_assertion, grant)
        response = await client.client.get("http://models:8080" + target, headers={HEADER: token})
        if response.status_code in {401, 403}:
            raise CapabilityDenied(response.status_code)
        response.raise_for_status()
        return schema.model_validate(response.json())
    except CapabilityDenied as exc:
        raise HTTPException(
            exc.status, {"code": "model_catalog_access_denied", "message": "模型目录访问已撤销"}
        ) from None
    except (httpx.HTTPError, CapabilityUnavailable, ValueError):
        raise HTTPException(
            503, {"code": "model_catalog_unavailable", "message": "模型目录暂不可读"}
        ) from None


@generation.get(
    GENERATION_SOURCE,
    response_model=GenerationOptionsOut,
    dependencies=[Depends(require_studio_auth)],
)
async def generation_options(request: Request) -> GenerationOptionsOut:
    return await lookup(request, GENERATION_TARGET, GenerationOptionsOut)


@acceptance.get(
    "/v1/visual-workshop/projects/{project_id}/acceptance/models",
    response_model=AcceptanceModelListOut,
)
async def list_acceptance_models(
    project_id: str, request: Request, session: SessionDep, owner_user_id: OwnerDep
):
    with errors():
        await project(session, owner_user_id, project_id)
    await session.rollback()
    return await lookup(request, ACCEPTANCE_TARGET, AcceptanceModelListOut)
