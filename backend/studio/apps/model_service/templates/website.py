"""Role template storage and explicit account catalog reconciliation."""

from sqlalchemy import select

from studio.apps.identity.credentials.operations import add_audit_event
from studio.apps.identity.storage.governance import begin_governance, require_platform_admin
from studio.apps.model_service.admission.website_quotas import ACTIVE, TASK_MODELS
from studio.apps.model_service.catalog.legacy_defaults import LegacyCatalogDefaults
from studio.apps.model_service.catalog.template_reconciliation import (
    apply_template as reconcile_template,
)
from studio.apps.model_service.catalog.template_reconciliation import catalog_rows as catalog_rows
from studio.apps.model_service.catalog.template_reconciliation import (
    reconciliation_preview as reconciliation_preview,
)
from studio.apps.model_service.catalog.template_values import prepare_template
from studio.apps.model_service.catalog.template_values import template_view as template_view
from studio.apps.model_service.storage.models.model_service import ModelCatalogState
from studio.apps.model_service.storage.website_settings import model_settings, read_setting
from studio.contracts.identity.errors import AccountError
from studio.runtime.database.ownership import bind_owner
from studio.runtime.database.settings_records import SettingConflict


async def get_template(session, role, *, cipher):
    state = await read_setting(session, f"role_template:{role}", {"providers": [], "defaults": {}})
    return {
        "role": role,
        "revision": state["revision"],
        "value": template_view(state["value"], cipher=cipher),
    }


async def save_template(session, principal, role, body, client_ip, *, cipher):
    # Input carries only replacement secrets. Output never returns ciphertext or plaintext.

    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    current = await read_setting(
        session, f"role_template:{role}", {"providers": [], "defaults": {}}
    )
    if current["revision"] != body.expected_revision:
        raise AccountError(
            "revision_conflict",
            current={
                "revision": current["revision"],
                "value": template_view(current["value"], cipher=cipher),
            },
        )
    value = prepare_template(body.value, current["value"], cipher=cipher)
    # Keep authorization and CAS under the same writer transaction.

    try:
        await model_settings(session).replace(
            f"role_template:{role}", value, expected_revision=body.expected_revision
        )
    except SettingConflict as exc:
        raise AccountError(
            "revision_conflict",
            current={
                "revision": exc.current["revision"],
                "value": template_view(exc.current["value"], cipher=cipher),
            },
        ) from exc
    add_audit_event(
        session,
        "platform.model_template.updated",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"role_to": role, "revision": body.expected_revision + 1},
    )
    await session.commit()
    return await get_template(session, role, cipher=cipher)


class LegacyTemplateTaskUsage:
    def __init__(self, session):
        self.session = session

    async def account_active(self, *, owner_user_id):
        for model in TASK_MODELS.values():
            if await self.session.scalar(
                select(model.id)
                .where(model.owner_user_id == owner_user_id, model.status.in_(ACTIVE))
                .limit(1)
            ):
                return True
        return False


async def apply_template(session, owner_user_id, payload, expected_revision):
    previous = session.info.get("owner_user_id")
    if previous is not None and previous != owner_user_id:
        raise ValueError("模板合并不能替换已有账号上下文")
    bind_owner(session, owner_user_id)
    try:
        return await reconcile_template(
            session,
            owner_user_id,
            payload,
            expected_revision,
            defaults_store=LegacyCatalogDefaults(session),
            task_usage=LegacyTemplateTaskUsage(session),
        )
    finally:
        if previous is None:
            session.info.pop("owner_user_id", None)


async def initialize_from_template(session, owner_user_id, role):
    state = await read_setting(session, f"role_template:{role}", {})
    if not state["value"].get("providers") and not state["value"].get("suppliers"):
        return False
    session.add(ModelCatalogState(owner_user_id=owner_user_id, revision=0))
    await session.flush()
    await apply_template(session, owner_user_id, state["value"], 0)
    return True
