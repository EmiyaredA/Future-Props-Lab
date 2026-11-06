from fastapi import APIRouter, HTTPException, Query, Request

from studio.apps.model_service.catalog.defaults import update_defaults
from studio.apps.model_service.catalog.http_bindings import CatalogDep, CipherDep, DefaultsDep
from studio.apps.model_service.catalog.service import (
    CatalogResourceBusyError,
    DuplicateModelError,
    ResourceNotFoundError,
)
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.contracts.model_service.schemas.model_service import (
    DeleteMutationOut,
    ModelCatalogOut,
    ModelCategoryListOut,
    ModelDefaultsIn,
    ModelEntryIn,
    ModelMutationOut,
    ProviderEnabledIn,
    ProviderIn,
    ProviderMutationOut,
)

router = APIRouter(tags=["models"])


def _not_found(exc: ResourceNotFoundError) -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": str(exc)})


@router.get("/model-providers", response_model=ModelCatalogOut)
async def list_providers(catalog: CatalogDep) -> ModelCatalogOut:
    return await catalog.catalog()


@router.get("/model-categories", response_model=ModelCategoryListOut)
async def list_model_categories(catalog: CatalogDep) -> ModelCategoryListOut:
    return catalog.categories()


@router.post("/model-providers", response_model=ProviderMutationOut)
async def create_provider(catalog: CatalogDep, body: ProviderIn) -> ProviderMutationOut:
    try:
        revision, provider = await catalog.create_provider(body)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    return ProviderMutationOut(revision=revision, provider=provider)


@router.patch("/model-providers/{provider_id}", response_model=ProviderMutationOut)
async def update_provider(
    catalog: CatalogDep, provider_id: str, body: ProviderIn
) -> ProviderMutationOut:
    try:
        revision, provider = await catalog.update_provider(provider_id, body)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return ProviderMutationOut(revision=revision, provider=provider)


@router.post("/model-providers/{provider_id}/enabled", response_model=ProviderMutationOut)
async def set_provider_enabled(
    catalog: CatalogDep, provider_id: str, body: ProviderEnabledIn
) -> ProviderMutationOut:
    try:
        revision, provider = await catalog.set_provider_enabled(
            provider_id, body.enabled, body.expected_catalog_revision
        )
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return ProviderMutationOut(revision=revision, provider=provider)


@router.delete("/model-providers/{provider_id}", response_model=DeleteMutationOut)
async def delete_provider(
    catalog: CatalogDep,
    provider_id: str,
    expected_catalog_revision: int = Query(ge=0),
) -> DeleteMutationOut:
    try:
        revision = await catalog.delete_provider(provider_id, expected_catalog_revision)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return DeleteMutationOut(deleted=True, revision=revision)


@router.post("/model-providers/{provider_id}/models", response_model=ModelMutationOut)
async def add_model(catalog: CatalogDep, provider_id: str, body: ModelEntryIn) -> ModelMutationOut:
    try:
        revision, model = await catalog.add_model(provider_id, body)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except DuplicateModelError as exc:
        raise HTTPException(409, {"code": "duplicate_model", "message": str(exc)}) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return ModelMutationOut(revision=revision, model=model)


@router.patch("/model-entries/{model_id}", response_model=ModelMutationOut)
async def update_model(catalog: CatalogDep, model_id: str, body: ModelEntryIn) -> ModelMutationOut:
    try:
        revision, model = await catalog.update_model(model_id, body)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except DuplicateModelError as exc:
        raise HTTPException(409, {"code": "duplicate_model", "message": str(exc)}) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return ModelMutationOut(revision=revision, model=model)


@router.delete("/model-entries/{model_id}", response_model=DeleteMutationOut)
async def delete_model(
    catalog: CatalogDep,
    model_id: str,
    expected_catalog_revision: int = Query(ge=0),
) -> DeleteMutationOut:
    try:
        revision = await catalog.delete_model(model_id, expected_catalog_revision)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from None
    except CatalogResourceBusyError as exc:
        raise HTTPException(409, {"code": "resource_busy", "message": str(exc)}) from None
    return DeleteMutationOut(deleted=True, revision=revision)


@router.put("/model-catalog/defaults", response_model=ModelCatalogOut)
async def defaults(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: ModelDefaultsIn,
    defaults_store: DefaultsDep,
    cipher: CipherDep,
):
    try:
        return await update_defaults(
            session,
            owner_user_id,
            body,
            defaults_store=defaults_store,
            cipher=cipher,
            readiness=request.app.state.model_catalog_bindings.readiness,
        )
    except ValueError as exc:
        raise HTTPException(422, {"code": "invalid_default_model", "message": str(exc)}) from None
