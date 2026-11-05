"""Monolith account provisioning, including the legacy atomic model catalog."""

from app.console.governance.account_creation import create_account as create_identity_account
from app.console.governance.account_creation import (
    create_managed_account as create_identity_managed_account,
)
from app.console.governance.model_templates import initialize_from_template
from app.llm.catalog.seed import ensure_account_model_catalog
from studio.runtime.database.ownership import bind_owner


async def create_account(session, **values):
    return await create_identity_account(session, initializer=initialize_account_catalog, **values)


async def initialize_account_catalog(session, owner_user_id, role="user"):
    previous = session.info.get("owner_user_id")
    bind_owner(session, owner_user_id)
    try:
        if not await initialize_from_template(session, owner_user_id, role):
            await ensure_account_model_catalog(session, owner_user_id)
        await session.flush()
    finally:
        if previous is None:
            session.info.pop("owner_user_id", None)
        else:
            bind_owner(session, previous)


async def create_managed_account(session, principal, **values):
    return await create_identity_managed_account(
        session, principal, account_creator=create_account, **values
    )
