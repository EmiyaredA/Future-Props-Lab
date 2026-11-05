"""Single-instance admission ledger; submitted task ownership survives restarts."""

from sqlalchemy import select, text, update

from app.console.governance.settings_records import read_setting
from app.console.models import AuthSession, ManagementApiKey, User
from app.console.schemas.platform_governance import RuntimeQuotas
from studio.apps.model_service.storage.models.runtime_admission import RuntimeAdmission as Admission
from studio.assembly.website.models import RUNTIME_QUOTA_TASK_MODELS
from studio.contracts.identity.errors import AccountError
from studio.runtime.time import utc_now

TASK_MODELS = {
    **RUNTIME_QUOTA_TASK_MODELS,
}
ACTIVE = ("queued", "submitting", "pending", "processing", "running")


async def settle_admissions(session):
    leases = list(await session.scalars(select(Admission).where(Admission.released_at.is_(None))))
    # Queue admissions are per child task; read each task table once, not once per waiter.
    active_by_kind = {}
    for kind, model_type in TASK_MODELS.items():
        ids = {
            identity for lease in leases if lease.task_kind == kind for identity in lease.task_ids
        }
        if not ids:
            continue
        model = model_type.__table__.c
        active_by_kind[kind] = set(
            (
                await session.execute(
                    select(model.id, model.owner_user_id).where(model.status.in_(ACTIVE))
                )
            ).all()
        )
    for lease in leases:
        if lease.task_kind and lease.task_ids:
            active = sum(
                (identity, lease.owner_user_id) in active_by_kind.get(lease.task_kind, set())
                for identity in lease.task_ids
            )
            if not active:
                lease.released_at = utc_now()
            else:
                lease.weight = active
    await session.flush()
    return [lease for lease in leases if not lease.released_at]


async def check_capacity(
    session, *, user_id, owner_user_id, role, voice, weight, excluding=None, submitted_ids=()
):
    if user_id != owner_user_id:
        raise AccountError("account_access_forbidden")
    policy = RuntimeQuotas.model_validate(
        (await read_setting(session, "runtime_quotas", RuntimeQuotas().model_dump()))["value"]
    )
    leases = [lease for lease in await settle_admissions(session) if lease.id != excluding]
    known = {
        kind: {task for lease in leases if lease.task_kind == kind for task in lease.task_ids}
        for kind in TASK_MODELS
    }
    legacy = []
    for kind, task_model in TASK_MODELS.items():
        model = task_model.__table__.c
        rows = (
            await session.execute(
                select(model.id, model.owner_user_id).where(model.status.in_(ACTIVE))
            )
        ).all()
        legacy.extend(
            (row.id, row.owner_user_id)
            for row in rows
            if row.id not in known[kind] and row.id not in submitted_ids
        )
    # Waiting tasks retain ownership, but do not consume execution capacity.
    leases = [lease for lease in leases if not lease.waiting]
    limit = getattr(policy, role)
    total = sum(lease.weight for lease in leases) + len(legacy)
    own = sum(lease.weight for lease in leases if lease.user_id == user_id)
    voices = sum(lease.weight for lease in leases if lease.realtime_voice)
    own_voices = sum(
        lease.weight for lease in leases if lease.realtime_voice and lease.user_id == user_id
    )
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


async def acquire(principal, *, sessions, voice=False, weight=1):
    async with sessions() as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        role = principal.platform_role or ("admin" if principal.is_platform_admin else "user")
        await check_capacity(
            session,
            user_id=principal.user_id,
            owner_user_id=principal.owner_user_id,
            role=role,
            voice=voice,
            weight=weight,
        )
        lease = Admission(
            user_id=principal.user_id,
            owner_user_id=principal.owner_user_id,
            platform_role=role,
            realtime_voice=voice,
            weight=weight,
        )
        session.add(lease)
        await session.commit()
        return lease.id


async def attach(session, lease_id, kind, task_ids):
    """Commit task ownership with task creation, never in a second transaction."""
    if not lease_id:
        return
    await session.flush()
    row = await session.get(Admission, lease_id)
    if row is None or row.released_at:
        raise AccountError("admission_not_found")
    model = TASK_MODELS[kind]
    found = set(
        await session.scalars(
            select(model.id).where(model.owner_user_id == row.owner_user_id, model.id.in_(task_ids))
        )
    )
    if found != set(task_ids):
        raise AccountError("task_not_found")
    weight = len(set(task_ids))
    if weight > row.weight:
        await check_capacity(
            session,
            user_id=row.user_id,
            owner_user_id=row.owner_user_id,
            role=row.platform_role,
            voice=False,
            weight=weight,
            excluding=row.id,
            submitted_ids=task_ids,
        )
    row.task_kind, row.task_ids = kind, list(task_ids)
    row.weight = max(1, weight)
    if not weight:
        row.released_at = utc_now()


async def release(lease_id, *, sessions):
    if not lease_id:
        return
    async with sessions() as session:
        row = await session.get(Admission, lease_id)
        if row is not None and not row.task_ids:
            row.released_at = utc_now()
            await session.commit()


async def recover_admissions(*, sessions):
    async with sessions() as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        await session.execute(
            update(Admission)
            .where(Admission.task_kind.is_(None), Admission.released_at.is_(None))
            .values(released_at=utc_now())
        )
        await settle_admissions(session)
        await session.commit()


async def validate_spawned_actor(session, principal):
    """Validate current authorization inside the task creation transaction."""
    user = await session.get(User, principal.user_id, populate_existing=True)
    credential_model = AuthSession if principal.auth_kind == "session" else ManagementApiKey
    credential = await session.get(
        credential_model, principal.session_id or principal.api_key_id, populate_existing=True
    )
    if (
        user is None
        or user.status != "active"
        or user.must_change_password
        or credential is None
        or credential.revoked_at
    ):
        raise AccountError("studio_auth_required")
    if principal.auth_kind == "management_api_key" and credential.expires_at <= utc_now():
        raise AccountError("studio_auth_required")
    if principal.auth_kind == "session" and (
        credential.user_id != principal.user_id
        or credential.idle_expires_at <= utc_now()
        or credential.absolute_expires_at <= utc_now()
    ):
        raise AccountError("account_access_changed")
    if "studio:write" not in principal.scopes:
        raise AccountError("account_access_changed")
    return user


async def admit_spawned_tasks(session, principal, kind, task_ids):
    """A newly confirmed background task has its own lifetime after the parent stream."""
    user = await validate_spawned_actor(session, principal)
    await check_capacity(
        session,
        user_id=user.id,
        owner_user_id=principal.owner_user_id,
        role=user.platform_role,
        voice=False,
        weight=len(task_ids),
        submitted_ids=task_ids,
    )
    session.add(
        Admission(
            user_id=user.id,
            owner_user_id=principal.owner_user_id,
            platform_role=user.platform_role,
            task_kind=kind,
            task_ids=list(task_ids),
            weight=len(task_ids),
        )
    )
