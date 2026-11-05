"""Account-wide visual generation waiting capacity and execution admission."""

from sqlalchemy import and_, func, or_, select, text

from app.console.governance.runtime_quotas import (
    TASK_MODELS,
    admit_spawned_tasks,
    check_capacity,
    settle_admissions,
    validate_spawned_actor,
)
from app.console.governance.settings_records import read_setting
from app.console.models import User
from app.console.schemas.platform_governance import RuntimeQuotas
from app.llm.models import ModelEntry
from app.llm.models.runtime_admission import RuntimeAdmission as Admission
from studio.contracts.identity.errors import AccountError
from studio.runtime.time import utc_now


async def admit_generation_tasks(session, principal, kind, task_ids):
    if kind != "visual":
        return await admit_spawned_tasks(session, principal, kind, task_ids)
    task = TASK_MODELS["visual"].__table__.c
    rows = (
        await session.execute(
            select(task.id, task.generation_kind).where(
                task.owner_user_id == principal.owner_user_id, task.id.in_(task_ids)
            )
        )
    ).all()
    if len(rows) != len(set(task_ids)):
        raise AccountError("task_not_found")
    if any(row.generation_kind not in {"image", "video"} for row in rows):
        return await admit_spawned_tasks(session, principal, kind, task_ids)
    user = await validate_spawned_actor(session, principal)
    policy = RuntimeQuotas.model_validate(
        (await read_setting(session, "runtime_quotas", RuntimeQuotas().model_dump()))["value"]
    )
    leases = await settle_admissions(session)
    waiting = sum(lease.weight for lease in leases if lease.waiting and lease.user_id == user.id)
    limit = getattr(policy.generation_queue, user.platform_role)
    # Task insertion already owns SQLite's writer lock. Include all new IDs as one batch
    # so legacy accounting cannot count unassigned children against running capacity.
    for task_id in task_ids:
        wait = waiting > 0
        if not wait:
            try:
                await check_capacity(
                    session,
                    user_id=user.id,
                    owner_user_id=principal.owner_user_id,
                    role=user.platform_role,
                    voice=False,
                    weight=1,
                    submitted_ids=task_ids,
                )
            except AccountError as exc:
                if exc.code != "runtime_quota_exceeded":
                    raise
                wait = True
        if wait:
            waiting += 1
            if waiting > limit:
                raise AccountError("generation_queue_full")
        session.add(
            Admission(
                user_id=user.id,
                owner_user_id=principal.owner_user_id,
                platform_role=user.platform_role,
                task_kind="visual",
                task_ids=[task_id],
                queue_task_id=task_id,
                waiting=wait,
                weight=1,
                created_at=utc_now(),
            )
        )
        await session.flush()


async def _actor(session, lease):
    user = await session.get(User, lease.user_id, populate_existing=True)
    if (
        not user
        or user.id != lease.owner_user_id
        or user.status != "active"
        or user.must_change_password
    ):
        raise ValueError("提交账号已不可用，生成任务未提交")
    return user


async def claim_visual_capacity(session, task):
    """Called inside the driver's writer transaction, before queued -> submitting."""
    if task.generation_kind not in {"image", "video"}:
        return True
    lease = await session.scalar(select(Admission).where(Admission.queue_task_id == task.id))
    if lease is None:
        legacy = await session.scalars(
            select(Admission).where(
                Admission.task_kind == "visual",
                Admission.queue_task_id.is_(None),
                Admission.owner_user_id == task.owner_user_id,
                Admission.released_at.is_(None),
            )
        )
        lease = next((row for row in legacy if task.id in row.task_ids), None)
        if lease is None:
            return True  # Pre-governance tasks retain legacy running accounting.
    if lease.released_at:
        raise ValueError("生成任务的额度归属已失效")
    user = await _actor(session, lease)
    model = await session.get(ModelEntry, task.model_id) if task.model_id else None
    if model is None or not model.enabled:
        raise ValueError("生成模型已停用或删除，生成任务未提交")
    if not lease.waiting:
        return True
    await settle_admissions(session)
    older = await session.scalar(
        select(Admission.id)
        .where(
            Admission.user_id == lease.user_id,
            Admission.waiting.is_(True),
            Admission.released_at.is_(None),
            Admission.id != lease.id,
            or_(
                Admission.created_at < lease.created_at,
                and_(Admission.created_at == lease.created_at, Admission.id < lease.id),
            ),
        )
        .limit(1)
    )
    if older:
        return False
    try:
        await check_capacity(
            session,
            user_id=user.id,
            owner_user_id=lease.owner_user_id,
            role=user.platform_role,
            voice=False,
            weight=1,
        )
    except AccountError as exc:
        if exc.code != "runtime_quota_exceeded":
            raise
        return False
    lease.waiting = False
    lease.platform_role = user.platform_role
    await session.flush()
    return True


async def visual_queue_candidates(session_factory, *, limit=40):
    """Skip blocked owners before limiting results; never delay provider polling."""
    task = TASK_MODELS["visual"].__table__.c
    async with session_factory() as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        await settle_admissions(session)
        rows = (
            await session.execute(
                select(task.id, Admission)
                .select_from(task.id.table)
                .outerjoin(Admission, Admission.queue_task_id == task.id)
                .where(task.status == "queued")
                .order_by(
                    func.coalesce(Admission.created_at, task.created_at), Admission.id, task.id
                )
            )
        ).all()
        candidates = []
        blocked = set()
        for task_id, lease in rows:
            if lease and lease.waiting:
                key = (lease.user_id, lease.owner_user_id)
                if key in blocked:
                    continue
                try:
                    user = await _actor(session, lease)
                except (AccountError, ValueError):
                    # Let the driver persist an actionable failure for invalid owners.
                    candidates.append(task_id)
                    if len(candidates) >= limit:
                        break
                    continue
                try:
                    await check_capacity(
                        session,
                        user_id=user.id,
                        owner_user_id=lease.owner_user_id,
                        role=user.platform_role,
                        voice=False,
                        weight=1,
                    )
                except AccountError as exc:
                    if exc.code != "runtime_quota_exceeded":
                        raise
                    blocked.add(key)
                    continue
            candidates.append(task_id)
            if len(candidates) >= limit:
                break
        await session.commit()
        return candidates
