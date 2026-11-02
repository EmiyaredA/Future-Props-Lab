"""Internal runner lookups bind persisted task ownership before reading business state.

These helpers do not authorize browser requests or cross-service task submissions.
The supplied model and session must belong to the runner's own service.
"""

from sqlalchemy import select

from app.runtime.ownership import bind_owner, require_owner_id


async def load_runner_task(session, task_type, task_id, *, subject):
    owner = session.info.get("owner_user_id")
    if not owner:
        previous = dict(session.info)
        session.info["allow_system_reads"] = True
        try:
            owner = await session.scalar(
                select(task_type.owner_user_id).where(task_type.id == task_id)
            )
        finally:
            if "allow_system_reads" in previous:
                session.info["allow_system_reads"] = previous["allow_system_reads"]
            else:
                session.info.pop("allow_system_reads", None)
        if owner is None:
            return None
        bind_owner(session, require_owner_id(owner, subject=subject))
    return await session.scalar(
        select(task_type).where(task_type.id == task_id, task_type.owner_user_id == owner)
    )


async def recovery_accounts(session_factory, task_type, *, statuses):
    async with session_factory(info={"allow_system_reads": True}) as session:
        owners = list(
            await session.scalars(
                select(task_type.owner_user_id)
                .where(task_type.status.in_(statuses))
                .distinct()
                .order_by(task_type.owner_user_id)
            )
        )
    return [require_owner_id(owner, subject="interrupted background task") for owner in owners]
