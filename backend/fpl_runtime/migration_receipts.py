"""Record an exact maintenance batch receipt inside the owner's write transaction."""

from fastapi import HTTPException
from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from .migration_batches import BatchReceipt


class ImportReceiptFields:
    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    receipt: Mapped[dict] = mapped_column(JSON)


def batch_receipt(batch):
    return BatchReceipt(
        run_id=batch.run_id,
        owner_id=batch.owner_id,
        batch_id=batch.batch_id,
        dataset=batch.dataset,
        sha256=batch.digest,
        record_count=len(batch.records),
    )


def receipt_key(receipt):
    return str(receipt.run_id), receipt.dataset, str(receipt.owner_id), str(receipt.batch_id)


async def has_receipt(session, model, receipt):
    previous = await session.get(model, receipt_key(receipt))
    if previous is None:
        return False
    if BatchReceipt.model_validate(previous.receipt) != receipt:
        raise HTTPException(409, {"code": "migration_batch_conflict"})
    return True


def record_receipt(session, model, receipt):
    run_id, dataset, owner_user_id, batch_id = receipt_key(receipt)
    session.add(
        model(
            run_id=run_id,
            dataset=dataset,
            owner_user_id=owner_user_id,
            batch_id=batch_id,
            receipt=receipt.model_dump(mode="json"),
        )
    )
