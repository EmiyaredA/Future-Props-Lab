"""Revisioned governance settings shared by resource allocation use cases."""

from app.console.models.platform_governance import PlatformSetting


async def read_setting(session, key, default):
    row = await session.get(PlatformSetting, key, populate_existing=True)
    return (
        {"revision": row.revision, "value": row.payload}
        if row
        else {"revision": 0, "value": default}
    )
