"""Director maintenance receipts use the same transaction as owned record writes."""

from fastapi import HTTPException
from sqlalchemy import JSON, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from fpl_runtime.migration_batches import BatchReceipt


class DirectorMaintenanceBase(DeclarativeBase):
    pass


class DirectorImportReceipt(DirectorMaintenanceBase):
    __tablename__ = "director_import_receipts"
    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    receipt: Mapped[dict] = mapped_column(JSON)


async def has_receipt(session, receipt):
    key = str(receipt.run_id), receipt.dataset, str(receipt.owner_id), str(receipt.batch_id)
    previous = await session.get(DirectorImportReceipt, key)
    if previous is None:
        return False
    if BatchReceipt.model_validate(previous.receipt) != receipt:
        raise HTTPException(409, {"code": "migration_batch_conflict"})
    return True


def record_receipt(session, receipt):
    session.add(
        DirectorImportReceipt(
            run_id=str(receipt.run_id),
            dataset=receipt.dataset,
            owner_user_id=str(receipt.owner_id),
            batch_id=str(receipt.batch_id),
            receipt=receipt.model_dump(mode="json"),
        )
    )
