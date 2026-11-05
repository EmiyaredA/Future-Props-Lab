"""Per-app model catalogue composition, without legacy database or workshop imports."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.model_service.catalog.default_storage import CatalogDefaults
from studio.apps.model_service.catalog.service import ModelCatalogService
from studio.apps.model_service.catalog.suppliers import ModelSupplierService
from studio.apps.model_service.catalog.task_usage import CatalogTaskUsage
from studio.assembly.http_dependencies import SessionDep, StudioAuth


@dataclass(frozen=True)
class CatalogBindings:
    defaults: Callable[[AsyncSession], CatalogDefaults]
    task_usage: Callable[[AsyncSession], CatalogTaskUsage]


def bindings(request):
    value = getattr(request.app.state, "model_catalog_bindings", None)
    if not isinstance(value, CatalogBindings):
        raise HTTPException(503, {"code": "model_catalog_unavailable"})
    return value


def catalog_case(request: Request, session: SessionDep, _principal: StudioAuth):
    owner = bindings(request)
    return ModelCatalogService(
        session,
        defaults_store=owner.defaults(session),
        task_usage=owner.task_usage(session),
    )


def supplier_case(request: Request, session: SessionDep, _principal: StudioAuth):
    owner = bindings(request)
    return ModelSupplierService(
        session,
        defaults_store=owner.defaults(session),
        task_usage=owner.task_usage(session),
    )


def default_storage(request: Request, session: SessionDep, _principal: StudioAuth):
    return bindings(request).defaults(session)


CatalogDep = Annotated[ModelCatalogService, Depends(catalog_case)]
SupplierDep = Annotated[ModelSupplierService, Depends(supplier_case)]
DefaultsDep = Annotated[CatalogDefaults, Depends(default_storage)]
