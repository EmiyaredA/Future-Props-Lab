"""Stop historical automatic reviews without deleting their evidence or decisions."""

from sqlalchemy import delete, select, text

from studio.apps.visual_workshop.acceptance.models import AcceptanceRun
from studio.runtime.time import utc_now


async def retire_pending_reviews(sessions, *, independent=False):
    # Enumerate only identities, then restore ownership for every write transaction.
    async with sessions(info={"allow_system_reads": True}) as db:
        owners = list(
            await db.scalars(
                select(AcceptanceRun.owner_user_id)
                .where(AcceptanceRun.status.in_(("queued", "processing")))
                .distinct()
            )
        )
    for owner in owners:
        async with sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            rows = list(
                await db.scalars(
                    select(AcceptanceRun).where(
                        AcceptanceRun.owner_user_id == owner,
                        AcceptanceRun.status.in_(("queued", "processing")),
                    )
                )
            )
            for row in rows:
                row.status = "cancelled"
                row.error_message = "自动验收功能已移除；历史输入与结果保留。"
                row.revision += 1
                row.updated_at = utc_now()
            if independent and rows:
                from studio.apps.visual_workshop.storage.review_dispatch_records import (
                    VisualReviewDispatch,
                )

                await db.execute(
                    delete(VisualReviewDispatch).where(
                        VisualReviewDispatch.owner_user_id == owner,
                        VisualReviewDispatch.run_id.in_([row.id for row in rows]),
                    )
                )
            await db.commit()
