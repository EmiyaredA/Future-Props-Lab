from fastapi import APIRouter, HTTPException, Query

from studio.apps.model_service.catalog.http_bindings import SupplierDep
from studio.apps.model_service.catalog.service import (
    CatalogResourceBusyError,
    ResourceNotFoundError,
)
from studio.apps.model_service.catalog.suppliers import ManagedSupplierError
from studio.contracts.model_service.schemas.model_service import DeleteMutationOut
from studio.contracts.model_service.schemas.model_supplier import (
    ModelSupplierIn,
    ModelSupplierMutationOut,
)

router = APIRouter(tags=["models"])


def supplier_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ResourceNotFoundError):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, ManagedSupplierError):
        return HTTPException(403, {"code": "template_managed", "message": str(exc)})
    return HTTPException(409, {"code": "resource_busy", "message": str(exc)})


@router.post("/model-suppliers", response_model=ModelSupplierMutationOut)
async def create_supplier(catalog: SupplierDep, body: ModelSupplierIn) -> ModelSupplierMutationOut:
    revision, supplier = await catalog.create_supplier(body)
    return ModelSupplierMutationOut(revision=revision, supplier=supplier)


@router.patch("/model-suppliers/{supplier_id}", response_model=ModelSupplierMutationOut)
async def update_supplier(
    catalog: SupplierDep, supplier_id: str, body: ModelSupplierIn
) -> ModelSupplierMutationOut:
    try:
        revision, supplier = await catalog.update_supplier(supplier_id, body)
    except (ResourceNotFoundError, ManagedSupplierError) as exc:
        raise supplier_error(exc) from None
    return ModelSupplierMutationOut(revision=revision, supplier=supplier)


@router.delete("/model-suppliers/{supplier_id}", response_model=DeleteMutationOut)
async def delete_supplier(
    catalog: SupplierDep, supplier_id: str, expected_catalog_revision: int = Query(ge=0)
) -> DeleteMutationOut:
    try:
        revision = await catalog.delete_supplier(supplier_id, expected_catalog_revision)
    except (ResourceNotFoundError, ManagedSupplierError, CatalogResourceBusyError) as exc:
        raise supplier_error(exc) from None
    return DeleteMutationOut(deleted=True, revision=revision)
