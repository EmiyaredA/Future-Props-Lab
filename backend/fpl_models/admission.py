"""Models-only execution leases; capacity never supplies authorization for a new task."""

from sqlalchemy import case, exists, func, or_, select, text

from app.capabilities.identity.errors import AccountError
from app.llm.admission import AdmissionBindings
from app.llm.models.runtime_admission import RuntimeAdmission as Admission
from app.llm.task_outcomes import (
    SUBMISSION_INTERRUPTED_MESSAGE,
    TERMINAL_STATUSES,
    confirmed_terminal,
)
from app.runtime.ids import new_id
from app.runtime.task_records import load_runner_task
from app.runtime.time import utc_now

from .quotas import QuotaPolicies
from .task_records import TASK_MODELS


def require_principal(principal):
    if (
        not principal.user_id
        or principal.user_id != principal.owner_user_id
        or principal.platform_role not in {"admin", "user"}
        or principal.must_change_password
        or "studio:write" not in principal.scopes
    ):
        raise AccountError("account_access_forbidden")


def require_owner(session, owner):
    if not owner or session.info.get("owner_user_id") != owner:
        raise ValueError("模型额度缺少匹配的账号上下文")


async def settle(session):
    """Release only confirmed owned outcomes; absent/unknown tasks keep their reservation."""
    owner = session.info.get("owner_user_id")
    require_owner(session, owner)
    leases = list(await session.scalars(select(Admission).where(Admission.released_at.is_(None))))
    for kind, model in TASK_MODELS.items():
        selected = [lease for lease in leases if lease.task_kind == kind and lease.task_ids]
        ids = {identity for lease in selected for identity in lease.task_ids}
        if not ids:
            continue
        rows = await session.scalars(select(model).where(model.id.in_(ids)))
        finished = {row.id for row in rows if confirmed_terminal(row)}
        for lease in selected:
            remaining = len(set(lease.task_ids) - finished)
            if remaining:
                lease.weight = remaining
            else:
                lease.released_at = utc_now()
    await session.flush()
    return [lease for lease in leases if lease.released_at is None]


async def usage(session, owner, *, excluding=None, submitted_kind=None, submitted_ids=()):
    """Fixed own-table aggregate queries include all accounts, never returning their records."""
    require_owner(session, owner)
    table = Admission.__table__.c
    active = [table.released_at.is_(None), table.waiting.is_(False)]
    if excluding:
        active.append(table.id != excluding)
    result = await session.execute(
        select(
            func.coalesce(func.sum(table.weight), 0),
            func.coalesce(func.sum(case((table.owner_user_id == owner, table.weight), else_=0)), 0),
            func.coalesce(func.sum(case((table.realtime_voice, table.weight), else_=0)), 0),
            func.coalesce(
                func.sum(
                    case(
                        (table.realtime_voice & (table.owner_user_id == owner), table.weight),
                        else_=0,
                    )
                ),
                0,
            ),
        ).where(*active)
    )
    total, own, voices, own_voices = result.one()
    # Restored tasks without a lease still consume capacity. Waiting tasks already have
    # a lease and are excluded. JSON membership stays entirely inside SQLite.
    members = func.json_each(table.task_ids).table_valued("value")
    for kind, model in TASK_MODELS.items():
        task = model.__table__.c
        known = exists(
            select(1)
            .select_from(Admission.__table__)
            .join(members, text("1=1"))
            .where(
                table.owner_user_id == task.owner_user_id,
                table.task_kind == kind,
                table.released_at.is_(None),
                members.c.value == task.id,
            )
        )
        unsettled = or_(
            task.status.not_in(TERMINAL_STATUSES),
            task.error_message == SUBMISSION_INTERRUPTED_MESSAGE,
        )
        filters = [unsettled, ~known]
        if kind == submitted_kind and submitted_ids:
            filters.append(~((task.owner_user_id == owner) & task.id.in_(submitted_ids)))
        count, own_count = (
            await session.execute(
                select(
                    func.count(),
                    func.coalesce(func.sum(case((task.owner_user_id == owner, 1), else_=0)), 0),
                )
                .select_from(model.__table__)
                .where(*filters)
            )
        ).one()
        total += count
        own += own_count
    return total, own, voices, own_voices


async def check_capacity(
    session,
    *,
    owner,
    role,
    voice=False,
    weight=1,
    excluding=None,
    submitted_kind=None,
    submitted_ids=(),
):
    if type(weight) is not int or not 1 <= weight <= 1024:
        raise ValueError("额度权重必须是 1 至 1024 的整数")
    if role not in {"admin", "user"}:
        raise ValueError("额度账号角色无效")
    require_owner(session, owner)
    await settle(session)
    policy = (await QuotaPolicies(session).read())["value"]
    total, own, voices, own_voices = await usage(
        session,
        owner,
        excluding=excluding,
        submitted_kind=submitted_kind,
        submitted_ids=submitted_ids,
    )
    limit = getattr(policy, role)
    ceiling = policy.instance.total - (policy.reserved_for_admins if role == "user" else 0)
    if (
        total + weight > ceiling
        or own + weight > limit.total
        or (
            voice
            and (
                voices + weight > policy.instance.realtime_voice
                or own_voices + weight > limit.realtime_voice
            )
        )
    ):
        raise AccountError("runtime_quota_exceeded")


class ModelAdmission:
    def __init__(self, session_factory):
        self.sessions = session_factory

    def bindings(self, *, admit_tasks):
        """The assembler MUST supply separately authorized cross-service task admission."""
        return AdmissionBindings(
            acquire=self.acquire, release=self.release, attach=self.attach, admit_tasks=admit_tasks
        )

    async def acquire(self, principal, *, voice=False, weight=1):
        require_principal(principal)
        lease_id, committing = new_id(), False
        try:
            async with self.sessions(info={"owner_user_id": principal.owner_user_id}) as session:
                await session.execute(text("BEGIN IMMEDIATE"))
                await check_capacity(
                    session,
                    owner=principal.owner_user_id,
                    role=principal.platform_role,
                    voice=voice,
                    weight=weight,
                )
                session.add(
                    Admission(
                        id=lease_id,
                        user_id=principal.user_id,
                        owner_user_id=principal.owner_user_id,
                        platform_role=principal.platform_role,
                        realtime_voice=voice,
                        weight=weight,
                    )
                )
                committing = True
                await session.commit()
            return lease_id
        except BaseException as exc:
            # The commit may already have succeeded, but the caller never received the
            # ID and cannot release it. This function has not authorized/created a job.
            if committing:
                try:
                    await self.release(lease_id)
                except Exception:
                    exc.add_note("模型额度释放状态未确认；启动恢复将继续核对")
            raise

    async def attach(self, session, lease_id, kind, task_ids):
        """Attach inside the task creation transaction; immutable replay cannot change tasks."""
        if kind not in TASK_MODELS:
            raise ValueError("任务不属于 Models 服务")
        owner = session.info.get("owner_user_id")
        require_owner(session, owner)
        await session.flush()
        lease = await session.scalar(select(Admission).where(Admission.id == lease_id))
        if lease is None or lease.released_at:
            raise AccountError("admission_not_found")
        identities = sorted(set(task_ids))
        if lease.task_kind:
            if lease.task_kind != kind or set(lease.task_ids) != set(identities):
                raise AccountError("admission_not_found")
            return
        task = TASK_MODELS[kind]
        found = set(await session.scalars(select(task.id).where(task.id.in_(identities))))
        if found != set(identities):
            raise AccountError("task_not_found")
        other_leases = await session.scalars(
            select(Admission).where(
                Admission.task_kind == kind,
                Admission.id != lease.id,
                Admission.released_at.is_(None),
            )
        )
        if any(set(row.task_ids).intersection(identities) for row in other_leases):
            raise AccountError("admission_not_found")
        if identities:
            await check_capacity(
                session,
                owner=owner,
                role=lease.platform_role,
                voice=lease.realtime_voice,
                weight=len(identities),
                excluding=lease.id,
                submitted_kind=kind,
                submitted_ids=identities,
            )
        lease.task_kind, lease.task_ids = kind, identities
        lease.weight = max(1, len(identities))
        if not identities:
            lease.released_at = utc_now()
        await session.flush()

    async def release(self, lease_id):
        if not lease_id:
            return
        async with self.sessions() as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            lease = await load_runner_task(session, Admission, lease_id, subject="模型额度")
            if lease is None:
                return
            if not lease.task_kind:
                lease.released_at = utc_now()
            else:
                await settle(session)
            await session.commit()

    async def recover(self):
        """Run once before accepting requests; only vanished synchronous leases expire."""
        async with self.sessions(info={"allow_system_reads": True}) as session:
            owners = list(
                await session.scalars(
                    select(Admission.owner_user_id)
                    .where(Admission.released_at.is_(None))
                    .distinct()
                )
            )
        for owner in owners:
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(text("BEGIN IMMEDIATE"))
                leases = await settle(session)
                for lease in leases:
                    if lease.task_kind is None:
                        lease.released_at = utc_now()
                await session.commit()
