"""Shared validation quota transactions do not import Integration executor state."""

from fastapi import HTTPException
from sqlalchemy import select, text

from studio.apps.model_service.admission.admission import check_capacity
from studio.apps.model_service.storage.integration_records import IntegrationCapacity
from studio.runtime.time import utc_now


async def acquire_capacity(sessions, intent_id, actor, scope):
    from app.llm.models.runtime_admission import RuntimeAdmission
    from studio.contracts.integrations.integration_intents import digest
    from studio.runtime.ids import new_id

    fingerprint = digest(scope.model_dump(mode="json"))
    async with sessions(info={"owner_user_id": actor.user_id}) as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        prior = await session.get(IntegrationCapacity, str(intent_id))
        if prior is not None:
            if prior.fingerprint != fingerprint:
                raise HTTPException(409, "integration_capacity_conflict")
            return {"accepted": True, "released": bool(prior.outcome)}
        await check_capacity(session, owner=actor.user_id, role=actor.platform_role)
        lease_id = new_id()
        session.add(
            RuntimeAdmission(
                id=lease_id,
                user_id=actor.user_id,
                owner_user_id=actor.user_id,
                platform_role=actor.platform_role,
                realtime_voice=False,
                weight=1,
                task_kind="integration-validation",
                task_ids=[str(scope.task_id)],
            )
        )
        session.add(
            IntegrationCapacity(
                intent_id=str(intent_id),
                owner_user_id=actor.user_id,
                fingerprint=fingerprint,
                lease_id=lease_id,
            )
        )
        await session.commit()
    return {"accepted": True, "released": False}


async def release_capacity(sessions, intent_id, actor, _scope, outcome):
    from app.llm.models.runtime_admission import RuntimeAdmission

    async with sessions(info={"owner_user_id": actor.user_id}) as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        prior = await session.get(IntegrationCapacity, str(intent_id))
        if prior is None:
            # A response-lost acquire may arrive later; this tombstone prevents it.
            from studio.contracts.integrations.integration_intents import digest
            from studio.runtime.ids import new_id

            session.add(
                IntegrationCapacity(
                    intent_id=str(intent_id),
                    owner_user_id=actor.user_id,
                    fingerprint=digest(_scope.model_dump(mode="json")),
                    lease_id=new_id(),
                    outcome=outcome,
                )
            )
        else:
            if prior.outcome and prior.outcome != outcome:
                raise HTTPException(409, "integration_capacity_outcome_conflict")
            lease = await session.scalar(
                select(RuntimeAdmission).where(RuntimeAdmission.id == prior.lease_id)
            )
            if lease is not None:
                lease.released_at = utc_now()
            prior.outcome = outcome
        await session.commit()
    return {"released": True}
