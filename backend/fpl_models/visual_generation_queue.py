"""Visual image and video requests retain the existing waiting and execution quotas."""

from sqlalchemy import and_, or_, select

from app.capabilities.identity.errors import AccountError
from app.llm.models import ModelEntry, RuntimeAdmission
from app.runtime.time import utc_now

from .admission import check_capacity, settle
from .quotas import QuotaPolicies


async def admit(session, owner, role, tasks):
    policy = (await QuotaPolicies(session).read())["value"]
    waiting = sum(
        lease.weight
        for lease in await settle(session)
        if lease.task_kind == "visual" and lease.waiting
    )
    limit = getattr(policy.generation_queue, role)
    submitted = [task.id for task in tasks]
    for task in tasks:
        queued_kind = task.generation_kind in {"image", "video"}
        wait = queued_kind and waiting > 0
        if not wait:
            try:
                await check_capacity(
                    session,
                    owner=owner,
                    role=role,
                    voice=False,
                    weight=1,
                    submitted_kind="visual",
                    submitted_ids=submitted,
                )
            except AccountError as exc:
                if not queued_kind or exc.code != "runtime_quota_exceeded":
                    raise
                wait = True
        if wait:
            waiting += 1
            if waiting > limit:
                raise AccountError("generation_queue_full")
        session.add(
            RuntimeAdmission(
                user_id=owner,
                owner_user_id=owner,
                platform_role=role,
                task_kind="visual",
                task_ids=[task.id],
                queue_task_id=task.id if queued_kind else None,
                waiting=wait,
                weight=1,
                created_at=utc_now(),
            )
        )
        await session.flush()


async def claim(session, task):
    if task.generation_kind not in {"image", "video"}:
        return True
    lease = await session.scalar(
        select(RuntimeAdmission).where(RuntimeAdmission.queue_task_id == task.id)
    )
    if lease is None or lease.released_at:
        raise ValueError("生成任务的额度归属已失效")
    model = await session.get(ModelEntry, task.model_id)
    if model is None or not model.enabled:
        raise ValueError("生成模型已停用或删除，生成任务未提交")
    if not lease.waiting:
        return True
    await settle(session)
    older = await session.scalar(
        select(RuntimeAdmission.id)
        .where(
            RuntimeAdmission.owner_user_id == task.owner_user_id,
            RuntimeAdmission.waiting.is_(True),
            RuntimeAdmission.released_at.is_(None),
            or_(
                RuntimeAdmission.created_at < lease.created_at,
                and_(
                    RuntimeAdmission.created_at == lease.created_at, RuntimeAdmission.id < lease.id
                ),
            ),
        )
        .limit(1)
    )
    if older:
        return False
    try:
        await check_capacity(
            session,
            owner=task.owner_user_id,
            role=lease.platform_role,
            voice=False,
            weight=1,
        )
    except AccountError as exc:
        if exc.code != "runtime_quota_exceeded":
            raise
        return False
    lease.waiting = False
    await session.flush()
    return True
