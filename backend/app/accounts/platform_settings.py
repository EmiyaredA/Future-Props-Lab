from app.accounts.errors import AccountError
from app.accounts.governance_transactions import begin_governance, cas, require_platform_admin
from app.accounts.service import add_audit_event
from app.models.platform_governance import PlatformSetting


async def write_setting(
    session, principal, key: str, value: dict, expected_revision: int, client_ip=""
):
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    row = await session.get(PlatformSetting, key)
    if row is None:
        if expected_revision != 0:
            raise AccountError("revision_conflict", current={"revision": 0})
        row = PlatformSetting(id=key, payload=value, revision=1)
        session.add(row)
    else:
        row = await cas(session, PlatformSetting, key, expected_revision, payload=value)
    add_audit_event(
        session,
        f"platform.{key}.updated",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"revision": expected_revision + 1},
    )
    await session.commit()
    return {"revision": row.revision, "value": row.payload}
