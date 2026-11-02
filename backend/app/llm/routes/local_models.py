from fastapi import APIRouter, Request

from app.console.governance.local_models import can_manage_local_models, manage_local_model
from app.deps import StudioAuth
from app.llm.catalog.http_bindings import CatalogDep
from app.llm.http_errors import mapped
from app.llm.schemas.local_models import (
    LocalModelActionIn,
    LocalModelAttachIn,
    LocalModelOut,
    LocalModelsOut,
)
from app.llm.schemas.model_service import ModelCatalogOut

router = APIRouter(tags=["local-models"])


@router.get("/local-models", response_model=LocalModelsOut)
async def list_models(request: Request, principal: StudioAuth):
    return await request.app.state.local_models.list(can_manage_local_models(principal))


@router.post("/platform/local-models/{model_id}/actions", response_model=LocalModelOut)
async def model_action(
    model_id: str, body: LocalModelActionIn, request: Request, principal: StudioAuth
):
    return await mapped(
        manage_local_model(request.app.state.local_models, principal, model_id, body)
    )


@router.post("/local-models/attach", response_model=ModelCatalogOut)
async def attach_model(body: LocalModelAttachIn, catalog: CatalogDep):
    return await mapped(catalog.attach_local_model(body))
