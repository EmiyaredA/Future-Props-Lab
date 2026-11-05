"""Identity-owned non-secret attribution for an already authenticated API key."""

from fastapi import HTTPException

from studio.apps.identity.storage.models.accounts import ManagementApiKey


async def credential_metadata(session, principal):
    if principal.auth_kind != "management_api_key":
        return {}
    key = await session.get(ManagementApiKey, principal.api_key_id)
    if key is None or key.user_id != principal.user_id or key.revoked_at is not None:
        raise HTTPException(401, "credential_unavailable")
    return {"api_key_name": key.name, "api_key_prefix": key.key_prefix}
