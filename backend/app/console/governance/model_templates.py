"""Role template storage and explicit account catalog reconciliation."""

from sqlalchemy import select

from app.console.governance.governance_transactions import (
    begin_governance,
    cas,
    require_platform_admin,
)
from app.console.governance.runtime_quotas import ACTIVE, TASK_MODELS
from app.console.governance.service import add_audit_event
from app.console.governance.settings_records import read_setting
from app.console.models.platform_governance import PlatformSetting
from app.llm.catalog.legacy_defaults import LegacyCatalogDefaults
from app.llm.catalog.template_reconciliation import apply_template as reconcile_template
from app.llm.catalog.template_reconciliation import catalog_rows as catalog_rows
from app.llm.catalog.template_reconciliation import reconciliation_preview as reconciliation_preview
from app.llm.catalog.template_values import prepare_template
from app.llm.catalog.template_values import template_view as template_view
from app.llm.models import ModelCatalogState
from studio.contracts.identity.errors import AccountError
from studio.runtime.database.ownership import bind_owner


async def get_template(session, role):
    state = await read_setting(session, f"role_template:{role}", {"providers": [], "defaults": {}})
    return {"role": role, "revision": state["revision"], "value": template_view(state["value"])}


async def save_template(session, principal, role, body, client_ip):
    # Input carries only replacement secrets. Output never returns ciphertext or plaintext.

    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    current = await read_setting(
        session, f"role_template:{role}", {"providers": [], "defaults": {}}
    )
    if current["revision"] != body.expected_revision:
        raise AccountError(
            "revision_conflict",
            current={"revision": current["revision"], "value": template_view(current["value"])},
        )
    value = prepare_template(body.value, current["value"])
    # Keep authorization and CAS under the same writer transaction.

    row = await session.get(PlatformSetting, f"role_template:{role}")
    if row:
        await cas(session, PlatformSetting, row.id, body.expected_revision, payload=value)
    else:
        session.add(PlatformSetting(id=f"role_template:{role}", payload=value, revision=1))
    add_audit_event(
        session,
        "platform.model_template.updated",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"role_to": role, "revision": body.expected_revision + 1},
    )
    await session.commit()
    return await get_template(session, role)


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
