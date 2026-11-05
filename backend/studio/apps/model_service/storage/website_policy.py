from studio.apps.identity.credentials.operations import add_audit_event
from studio.apps.identity.storage.governance import begin_governance, require_platform_admin
from studio.apps.model_service.storage.website_settings import model_settings
from studio.contracts.identity.errors import AccountError
from studio.runtime.database.settings_records import SettingConflict


async def write_setting(
    session, principal, key: str, value: dict, expected_revision: int, client_ip=""
):
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    try:
        saved = await model_settings(session).replace(
            key, value, expected_revision=expected_revision
        )
    except SettingConflict as exc:
        raise AccountError("revision_conflict", current=exc.current) from exc
    add_audit_event(
        session,
        f"platform.{key}.updated",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"revision": expected_revision + 1},
    )
    await session.commit()
    return saved
