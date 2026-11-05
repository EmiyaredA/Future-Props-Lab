"""Compatibility-site bindings for the shared Guacamole bridge."""

import asyncio
from functools import partial

from studio.apps.identity.storage.cloud_access import desktop_authorized
from studio.apps.remote_desktop.transport import guacamole as desktop_bridge


async def _access(principal, local, _context=None, _epoch=None, *, sessions, preferences):
    async with sessions() as db:
        if not await desktop_authorized(db, principal, local=local):
            return None
    return (await preferences.read(owner=principal.user_id)).idle_minutes


async def watch_access(principal, local, inputs, changed, *, sessions, preferences):
    async def check():
        return await _access(principal, local, sessions=sessions, preferences=preferences)

    return await desktop_bridge.watch_access(inputs, changed, check)


async def _dial(settings):
    return await asyncio.open_connection("127.0.0.1", settings.fpl_cloud_control_guacd_port)


class DesktopConnection(desktop_bridge.DesktopConnection):
    def __init__(self, *, sessions, settings_reader, attempts, preferences):
        super().__init__(
            settings=settings_reader,
            access=partial(_access, sessions=sessions, preferences=preferences),
            connect_upstream=_dial,
            attempts=attempts,
        )
