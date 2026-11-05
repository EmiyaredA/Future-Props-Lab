"""Owned policy CAS and inert audit intent commit in the same local transaction."""

from studio.apps.model_service.admission.quotas import QuotaPolicies
from studio.apps.model_service.audit.audit import add_event

from .templates import RoleTemplates


async def save_quotas(session, principal, body, audits):
    await session.rollback()
    prepared = await audits(
        "platform.runtime_quotas.updated", {"revision": body.expected_revision + 1}
    )
    result = await QuotaPolicies(session).save(body)
    add_event(session, principal.user_id, prepared)
    await session.commit()
    return result


async def save_template(session, principal, role, body, audits):
    await session.rollback()
    prepared = await audits(
        "platform.model_template.updated", {"role_to": role, "revision": body.expected_revision + 1}
    )
    result = await RoleTemplates(session).save(role, body)
    add_event(session, principal.user_id, prepared)
    await session.commit()
    return result
