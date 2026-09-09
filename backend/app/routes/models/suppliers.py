from fastapi import APIRouter, HTTPException, Query

from app.deps import SessionDep
from app.llm.catalog.service import CatalogResourceBusyError, ResourceNotFoundError
from app.llm.catalog.suppliers import ManagedSupplierError, ModelSupplierService
from app.schemas.model_service import DeleteMutationOut
from app.schemas.model_supplier import ModelSupplierIn, ModelSupplierMutationOut

router = APIRouter(tags=["models"])


def supplier_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ResourceNotFoundError):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, ManagedSupplierError):
        return HTTPException(403, {"code": "template_managed", "message": str(exc)})
    return HTTPException(409, {"code": "resource_busy", "message": str(exc)})


@router.post("/model-suppliers", response_model=ModelSupplierMutationOut)
async def create_supplier(session: SessionDep, body: ModelSupplierIn) -> ModelSupplierMutationOut:
    revision, supplier = await ModelSupplierService(session).create_supplier(body)
    return ModelSupplierMutationOut(revision=revision, supplier=supplier)


@router.patch("/model-suppliers/{supplier_id}", response_model=ModelSupplierMutationOut)
async def update_supplier(
    session: SessionDep, supplier_id: str, body: ModelSupplierIn
) -> ModelSupplierMutationOut:
    try:
        revision, supplier = await ModelSupplierService(session).update_supplier(supplier_id, body)
    except (ResourceNotFoundError, ManagedSupplierError) as exc:
        raise supplier_error(exc) from None
    return ModelSupplierMutationOut(revision=revision, supplier=supplier)


@router.delete("/model-suppliers/{supplier_id}", response_model=DeleteMutationOut)
async def delete_supplier(
    session: SessionDep, supplier_id: str, expected_catalog_revision: int = Query(ge=0)
) -> DeleteMutationOut:
    try:
        revision = await ModelSupplierService(session).delete_supplier(
            supplier_id, expected_catalog_revision
        )
    except (ResourceNotFoundError, ManagedSupplierError, CatalogResourceBusyError) as exc:
        raise supplier_error(exc) from None
    return DeleteMutationOut(deleted=True, revision=revision)
