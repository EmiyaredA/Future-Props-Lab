from sqlalchemy import func, select

from app.llm.catalog.service import (
    CatalogResourceBusyError,
    ModelCatalogService,
    ResourceNotFoundError,
)
from app.llm.catalog.supplier_records import get_supplier, supplier_out
from app.llm.models import ModelProvider
from app.llm.models.model_supplier import ModelSupplier
from app.llm.schemas.model_supplier import ModelSupplierIn, ModelSupplierOut


class ManagedSupplierError(Exception):
    pass


class ModelSupplierService(ModelCatalogService):
    async def _supplier(self, supplier_id: str) -> ModelSupplier:
        row = await get_supplier(self.session, self._workspace_id(), supplier_id)
        if row is None:
            raise ResourceNotFoundError("协议类型不存在")
        return row

    @staticmethod
    def _writable(row: ModelSupplier) -> None:
        if row.origin == "role_template":
            raise ManagedSupplierError("该协议类型由平台模板管理，请在管理中台修改")

    async def create_supplier(self, body: ModelSupplierIn) -> tuple[int, ModelSupplierOut]:
        revision = await self._bump(body.expected_catalog_revision)
        count = await self.session.scalar(
            select(func.count(ModelSupplier.id)).where(
                ModelSupplier.workspace_id == self._workspace_id()
            )
        )
        row = ModelSupplier(
            workspace_id=self._workspace_id(), name=body.name, sort_order=int(count or 0)
        )
        self.session.add(row)
        await self.session.flush()
        result = supplier_out(row)
        await self.session.commit()
        return revision, result

    async def update_supplier(
        self, supplier_id: str, body: ModelSupplierIn
    ) -> tuple[int, ModelSupplierOut]:
        revision = await self._bump(body.expected_catalog_revision)
        row = await self._supplier(supplier_id)
        self._writable(row)
        row.name = body.name
        result = supplier_out(row)
        await self.session.commit()
        return revision, result

    async def delete_supplier(self, supplier_id: str, expected: int) -> int:
        revision = await self._bump(expected)
        row = await self._supplier(supplier_id)
        self._writable(row)
        count = await self.session.scalar(
            select(func.count(ModelProvider.id)).where(ModelProvider.supplier_id == supplier_id)
        )
        if count:
            raise CatalogResourceBusyError("协议类型仍有接入连接，请先移出连接再删除")
        await self.session.delete(row)
        await self.session.commit()
        return revision
