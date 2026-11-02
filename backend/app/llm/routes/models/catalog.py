from fastapi import APIRouter, HTTPException, Query

from app.deps import OwnerDep, SessionDep, StudioAuth
from app.llm.call_logs.credentials import snapshot_from_principal
from app.llm.catalog import ModelCatalogService
from app.llm.catalog.defaults import update_defaults
from app.llm.catalog.legacy_usage import LegacyCatalogTaskUsage
from app.llm.catalog.service import (
    CatalogResourceBusyError,
    DuplicateModelError,
    ResourceNotFoundError,
)
from app.llm.diagnostics import DiagnosticCallError, test_model
from app.llm.schemas.model_service import (
    DeleteMutationOut,
    ModelCatalogOut,
    ModelCategoryListOut,
    ModelDefaultsIn,
    ModelEntryIn,
    ModelMutationOut,
    ProviderEnabledIn,
    ProviderIn,
    ProviderMutationOut,
    TestModelOut,
)

router = APIRouter(tags=["models"])


def _not_found(exc: ResourceNotFoundError) -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": str(exc)})


@router.get("/model-providers", response_model=ModelCatalogOut)
async def list_providers(session: SessionDep) -> ModelCatalogOut:
    return await ModelCatalogService(session, task_usage=LegacyCatalogTaskUsage(session)).catalog()


@router.get("/model-categories", response_model=ModelCategoryListOut)
async def list_model_categories(session: SessionDep) -> ModelCategoryListOut:
    return ModelCatalogService(session, task_usage=LegacyCatalogTaskUsage(session)).categories()


@router.post("/model-providers", response_model=ProviderMutationOut)
async def create_provider(session: SessionDep, body: ProviderIn) -> ProviderMutationOut:
    try:
        revision, provider = await ModelCatalogService(
            session, task_usage=LegacyCatalogTaskUsage(session)
        ).create_provider(body)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    return ProviderMutationOut(revision=revision, provider=provider)


@router.patch("/model-providers/{provider_id}", response_model=ProviderMutationOut)
async def update_provider(
    session: SessionDep, provider_id: str, body: ProviderIn
) -> ProviderMutationOut:
    try:
        revision, provider = await ModelCatalogService(
            session, task_usage=LegacyCatalogTaskUsage(session)
        ).update_provider(provider_id, body)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return ProviderMutationOut(revision=revision, provider=provider)


@router.post("/model-providers/{provider_id}/enabled", response_model=ProviderMutationOut)
async def set_provider_enabled(
    session: SessionDep, provider_id: str, body: ProviderEnabledIn
) -> ProviderMutationOut:
    try:
        revision, provider = await ModelCatalogService(
            session, task_usage=LegacyCatalogTaskUsage(session)
        ).set_provider_enabled(provider_id, body.enabled, body.expected_catalog_revision)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return ProviderMutationOut(revision=revision, provider=provider)


@router.delete("/model-providers/{provider_id}", response_model=DeleteMutationOut)
async def delete_provider(
    session: SessionDep,
    provider_id: str,
    expected_catalog_revision: int = Query(ge=0),
) -> DeleteMutationOut:
    try:
        revision = await ModelCatalogService(
            session, task_usage=LegacyCatalogTaskUsage(session)
        ).delete_provider(provider_id, expected_catalog_revision)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return DeleteMutationOut(deleted=True, revision=revision)


@router.post("/model-providers/{provider_id}/models", response_model=ModelMutationOut)
async def add_model(session: SessionDep, provider_id: str, body: ModelEntryIn) -> ModelMutationOut:
    try:
        revision, model = await ModelCatalogService(
            session, task_usage=LegacyCatalogTaskUsage(session)
        ).add_model(provider_id, body)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except DuplicateModelError as exc:
        raise HTTPException(409, {"code": "duplicate_model", "message": str(exc)}) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return ModelMutationOut(revision=revision, model=model)


@router.patch("/model-entries/{model_id}", response_model=ModelMutationOut)
async def update_model(session: SessionDep, model_id: str, body: ModelEntryIn) -> ModelMutationOut:
    try:
        revision, model = await ModelCatalogService(
            session, task_usage=LegacyCatalogTaskUsage(session)
        ).update_model(model_id, body)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except DuplicateModelError as exc:
        raise HTTPException(409, {"code": "duplicate_model", "message": str(exc)}) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return ModelMutationOut(revision=revision, model=model)


@router.delete("/model-entries/{model_id}", response_model=DeleteMutationOut)
async def delete_model(
    session: SessionDep,
    model_id: str,
    expected_catalog_revision: int = Query(ge=0),
) -> DeleteMutationOut:
    try:
        revision = await ModelCatalogService(
            session, task_usage=LegacyCatalogTaskUsage(session)
        ).delete_model(model_id, expected_catalog_revision)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return DeleteMutationOut(deleted=True, revision=revision)


@router.post("/model-entries/{model_id}/test", response_model=TestModelOut)
async def run_model_test(session: SessionDep, model_id: str, principal: StudioAuth) -> TestModelOut:
    try:
        credential = await snapshot_from_principal(session, principal)
        return await test_model(session, model_id, credential=credential)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except DiagnosticCallError as exc:
        detail = {"code": "model_test_failed", "message": str(exc)}
        if exc.log_id:
            detail["log_id"] = exc.log_id
        raise HTTPException(exc.status_code, detail) from None


@router.put("/model-catalog/defaults", response_model=ModelCatalogOut)
async def defaults(session: SessionDep, owner_user_id: OwnerDep, body: ModelDefaultsIn):
    try:
        return await update_defaults(session, owner_user_id, body)
    except ValueError as exc:
        raise HTTPException(422, {"code": "invalid_default_model", "message": str(exc)}) from None
