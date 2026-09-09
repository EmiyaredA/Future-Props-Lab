"""Single-instance admission ledger; submitted task ownership survives restarts."""

from sqlalchemy import select, text, update

from app.accounts.errors import AccountError
from app.accounts.platform_policy import read_setting
from app.core.db import SessionLocal
from app.core.time import utc_now
from app.models import (
    GalgameAssetTranscriptionTask,
    ModelTestGenerationTask,
    ModelTestTranscriptionTask,
    VisualGenerationTask,
)
from app.models.runtime_admission import RuntimeAdmission as Admission
from app.schemas.platform_governance import RuntimeQuotas

TASK_MODELS = {
    "visual": VisualGenerationTask,
    "model": ModelTestGenerationTask,
    "transcription": ModelTestTranscriptionTask,
    "galgame_asr": GalgameAssetTranscriptionTask,
}
ACTIVE = ("queued", "submitting", "pending", "processing", "running")


async def _settle(session):
    leases = list(await session.scalars(select(Admission).where(Admission.released_at.is_(None))))
    for lease in leases:
        if lease.task_kind and lease.task_ids:
            model = TASK_MODELS[lease.task_kind].__table__.c
            active = list(
                await session.scalars(
                    select(model.id).where(
                        model.workspace_id == lease.workspace_id,
                        model.id.in_(lease.task_ids),
                        model.status.in_(ACTIVE),
                    )
                )
            )
            if not active:
                lease.released_at = utc_now()
            else:
                lease.weight = len(active)
    await session.flush()
    return [lease for lease in leases if not lease.released_at]


async def check_capacity(
    session, *, user_id, workspace_id, role, voice, weight, excluding=None, submitted_ids=()
):
    policy = RuntimeQuotas.model_validate(
        (await read_setting(session, "runtime_quotas", RuntimeQuotas().model_dump()))["value"]
    )
    leases = [lease for lease in await _settle(session) if lease.id != excluding]
    known = {
        kind: {task for lease in leases if lease.task_kind == kind for task in lease.task_ids}
        for kind in TASK_MODELS
    }
    legacy = []
    for kind, task_model in TASK_MODELS.items():
        model = task_model.__table__.c
        rows = (
            await session.execute(
                select(model.id, model.workspace_id).where(model.status.in_(ACTIVE))
            )
        ).all()
        legacy.extend(
            (row.id, row.workspace_id)
            for row in rows
            if row.id not in known[kind] and row.id not in submitted_ids
        )
    limit = getattr(policy, role)
    total = sum(lease.weight for lease in leases) + len(legacy)
    workspace = sum(lease.weight for lease in leases if lease.workspace_id == workspace_id) + sum(
        1 for _, legacy_workspace_id in legacy if legacy_workspace_id == workspace_id
    )
    own = sum(lease.weight for lease in leases if lease.user_id == user_id)
    voices = sum(lease.weight for lease in leases if lease.realtime_voice)
    own_voices = sum(
        lease.weight for lease in leases if lease.realtime_voice and lease.user_id == user_id
    )
    ceiling = policy.instance.total - (policy.reserved_for_admins if role == "member" else 0)
    if (
        total + weight > ceiling
        or workspace + weight > policy.workspace_total
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


async def acquire(principal, *, voice=False, weight=1):
    async with SessionLocal() as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        role = principal.platform_role or (
            "super_admin" if principal.is_platform_admin else "member"
        )
        await check_capacity(
            session,
            user_id=principal.user_id,
            workspace_id=principal.workspace_id,
            role=role,
            voice=voice,
            weight=weight,
        )
        lease = Admission(
            user_id=principal.user_id,
            workspace_id=principal.workspace_id,
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
            select(model.id).where(model.workspace_id == row.workspace_id, model.id.in_(task_ids))
        )
    )
    if found != set(task_ids):
        raise AccountError("task_not_found")
    weight = len(set(task_ids))
    if weight > row.weight:
        await check_capacity(
            session,
            user_id=row.user_id,
            workspace_id=row.workspace_id,
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


async def release(lease_id):
    if not lease_id:
        return
    async with SessionLocal() as session:
        row = await session.get(Admission, lease_id)
        if row is not None and not row.task_ids:
            row.released_at = utc_now()
            await session.commit()


async def recover_admissions():
    async with SessionLocal() as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        await session.execute(
            update(Admission)
            .where(Admission.task_kind.is_(None), Admission.released_at.is_(None))
            .values(released_at=utc_now())
        )
        await _settle(session)
        await session.commit()
