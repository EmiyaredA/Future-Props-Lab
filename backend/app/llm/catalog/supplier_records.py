from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.models.model_supplier import ModelSupplier
from app.llm.schemas.model_supplier import ModelSupplierOut


def supplier_out(row: ModelSupplier) -> ModelSupplierOut:
    return ModelSupplierOut(
        id=row.id,
        name=row.name,
        origin=row.origin,
        template_key=row.template_key,
        managed_fields=["name"] if row.origin == "role_template" else [],
    )


async def get_supplier(
    session: AsyncSession, workspace_id: str, supplier_id: str
) -> ModelSupplier | None:
    return await session.scalar(
        select(ModelSupplier).where(
            ModelSupplier.id == supplier_id, ModelSupplier.workspace_id == workspace_id
        )
    )


async def list_suppliers(session: AsyncSession, workspace_id: str) -> list[ModelSupplierOut]:
    rows = await session.scalars(
        select(ModelSupplier)
        .where(ModelSupplier.workspace_id == workspace_id)
        .order_by(ModelSupplier.sort_order, ModelSupplier.name, ModelSupplier.id)
    )
    return [supplier_out(row) for row in rows]
