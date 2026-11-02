"""Owned role policy. Callers authorize administrators and own the save/audit transaction."""

from copy import deepcopy

from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert

from app.capabilities.identity.errors import AccountError
from app.llm.catalog.seed import ensure_account_model_catalog
from app.llm.catalog.template_reconciliation import apply_template
from app.llm.catalog.template_values import prepare_template, template_view
from app.llm.models import ModelCatalogState
from app.runtime.time import utc_now

from .defaults import OwnedCatalogDefaults
from .models import RoleTemplate
from .task_usage import OwnedCatalogTaskUsage


class RoleTemplates:
    def __init__(self, session):
        self.session = session

    async def snapshot(self, role):
        if role not in {"admin", "user"}:
            raise AccountError("invalid_platform_role")
        row = await self.session.scalar(
            select(RoleTemplate)
            .where(RoleTemplate.role == role)
            .execution_options(populate_existing=True)
        )
        return {
            "role": role,
            "revision": row.revision if row else 0,
            "value": deepcopy(row.payload) if row else {"providers": [], "defaults": {}},
        }

    async def view(self, role):
        state = await self.snapshot(role)
        return {**state, "value": template_view(state["value"])}

    async def save(self, role, body):
        current = await self.snapshot(role)
        if current["revision"] != body.expected_revision:
            raise AccountError(
                "revision_conflict",
                current={"revision": current["revision"], "value": template_view(current["value"])},
            )
        payload = prepare_template(body.value, current["value"])
        now = utc_now()
        if body.expected_revision == 0:
            statement = (
                insert(RoleTemplate)
                .values(role=role, payload=payload, revision=1, created_at=now, updated_at=now)
                .on_conflict_do_nothing(index_elements=[RoleTemplate.role])
            )
        else:
            statement = (
                update(RoleTemplate)
                .where(RoleTemplate.role == role, RoleTemplate.revision == body.expected_revision)
                .values(payload=payload, revision=body.expected_revision + 1, updated_at=now)
            )
        if (await self.session.execute(statement)).rowcount != 1:
            latest = await self.view(role)
            raise AccountError(
                "revision_conflict",
                current={"revision": latest["revision"], "value": latest["value"]},
            )
        return await self.view(role)


async def initialize_account_catalog(session, owner_user_id, role):
    """Local-only callback; the event consumer supplies current Identity role and ownership."""
    if session.info.get("owner_user_id") != owner_user_id:
        raise ValueError("目录初始化缺少匹配的账号上下文")
    state = await RoleTemplates(session).snapshot(role)
    payload = state["value"]
    if not payload.get("providers") and not payload.get("suppliers"):
        await ensure_account_model_catalog(session, owner_user_id)
        return
    session.add(ModelCatalogState(owner_user_id=owner_user_id, revision=0))
    await session.flush()
    await apply_template(
        session,
        owner_user_id,
        payload,
        0,
        defaults_store=OwnedCatalogDefaults(session),
        task_usage=OwnedCatalogTaskUsage(session),
    )
