from typing import Literal

from studio.apps.identity.credentials.operations import add_audit_event
from studio.apps.identity.storage.governance import begin_governance, cas
from studio.contracts.identity.errors import AccountError


async def certify_project(
    session,
    principal,
    kind: Literal["visual", "galgame"],
    project_id,
    body,
    client_ip,
    *,
    project_models,
):
    principal = await begin_governance(session, principal)
    if not principal.allows("projects.certify") or not principal.allows("content.write"):
        raise AccountError("project_certification_required")
    model = project_models[kind]
    row = await session.get(model, project_id)
    if row is None or row.owner_user_id != principal.owner_user_id:
        raise AccountError("project_not_found")
    row = await cas(
        session, model, project_id, body.expected_revision, is_official=body.is_official
    )
    add_audit_event(
        session,
        "project.certification.updated",
        actor_user_id=principal.user_id,
        owner_user_id=principal.owner_user_id,
        client_ip=client_ip,
        metadata={"status_to": "official" if body.is_official else "ordinary"},
    )
    await session.commit()
    return {"id": row.id, "is_official": row.is_official, "revision": row.revision}
