"""Platform policy is resolved afresh alongside every authenticated principal."""

from dataclasses import replace

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform_governance import PlatformSetting

CAPABILITIES = (
    "logs.cross_workspace",
    "diagnostics.model",
    "diagnostics.realtime",
    "tools.sensitive",
    "docs.developer",
    "projects.certify",
)
PLATFORM_ROLES = ("super_admin", "admin", "member")


def default_policy() -> dict:
    return {role: {key: role != "member" for key in CAPABILITIES} for role in PLATFORM_ROLES}


async def read_setting(session: AsyncSession, key: str, default: dict) -> dict:
    row = await session.get(PlatformSetting, key, populate_existing=True)
    return (
        {"revision": row.revision, "value": row.payload}
        if row
        else {"revision": 0, "value": default}
    )


async def apply_policy(session: AsyncSession, principal):
    state = await read_setting(session, "permission_policy", default_policy())
    role = principal.platform_role or ("super_admin" if principal.is_platform_admin else "member")
    values = state["value"].get(role, {})
    enabled = frozenset(
        key for key in CAPABILITIES if role == "super_admin" or values.get(key, False)
    )
    if role == "member":
        enabled -= {"projects.certify"}
    if principal.auth_kind != "session":
        enabled -= {"logs.cross_workspace"}
    return replace(
        principal,
        platform_role=role,
        platform_permissions=enabled,
        policy_revision=state["revision"],
    )
