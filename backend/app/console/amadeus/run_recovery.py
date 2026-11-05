"""Settle only the interrupted runs visible in the caller's owned session."""

from sqlalchemy import select, update

from app.console.amadeus.models import AmadeusAction, AmadeusMessage, AmadeusRun
from app.console.amadeus.run_records import ACTIVE
from studio.runtime.time import utc_now


async def recover_runs(session):
    now = utc_now()
    rows = list(await session.scalars(select(AmadeusRun).where(AmadeusRun.status.in_(ACTIVE))))
    if not rows:
        return
    active_ids = [row.id for row in rows]
    for row in rows:
        if row.partial_text and not row.response_message_id:
            message = AmadeusMessage(
                conversation_id=row.conversation_id,
                owner_user_id=row.owner_user_id,
                role="assistant",
                content=row.partial_text,
                references_json=[],
                run_id=row.id,
                status="interrupted",
            )
            session.add(message)
            await session.flush()
            row.response_message_id = message.id
    await session.execute(
        update(AmadeusRun)
        .where(AmadeusRun.id.in_(active_ids))
        .values(
            status="interrupted",
            active_owner_key=None,
            error_message="后端重启，任务已中断；未知结果不会自动重试",
            finished_at=now,
            updated_at=now,
        )
    )
    await session.execute(
        update(AmadeusAction)
        .where(AmadeusAction.run_id.in_(active_ids), AmadeusAction.status == "running")
        .values(
            status="unknown",
            result_json={"message": "后端重启，外部操作结果待核实"},
            updated_at=now,
        )
    )
    await session.execute(
        update(AmadeusAction)
        .where(AmadeusAction.run_id.in_(active_ids), AmadeusAction.status == "pending")
        .values(
            status="cancelled",
            result_json={"message": "运行中断，审批已失效"},
            updated_at=now,
        )
    )
    await session.commit()
