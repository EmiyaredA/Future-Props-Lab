"""Compatibility-site bindings for the shared Guacamole bridge."""

import asyncio
from functools import partial

from sqlalchemy.exc import OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeout

from studio.apps.identity.storage.cloud_access import desktop_authorized
from studio.apps.remote_desktop.transport import guacamole as desktop_bridge


async def _access(principal, local, _context=None, *, sessions, preferences, read_cloud_settings):
    try:
        async with sessions() as db:
            # Active connections must observe policy revocation on the next check.
            if not await desktop_authorized(
                db, principal, local=local, settings=read_cloud_settings()
            ):
                return None
        return (await preferences.read(owner=principal.user_id)).idle_minutes
    except (OperationalError, PoolTimeout) as error:
        raise desktop_bridge.DesktopAccessUnavailable from error


async def _dial(settings):
    return await asyncio.open_connection("127.0.0.1", settings.fpl_cloud_control_guacd_port)


class DesktopConnection(desktop_bridge.DesktopConnection):
    def __init__(self, *, sessions, settings_reader, attempts, preferences):
        super().__init__(
            settings=settings_reader,
            access=partial(
                _access,
                sessions=sessions,
                preferences=preferences,
                read_cloud_settings=settings_reader,
            ),
            connect_upstream=_dial,
            attempts=attempts,
        )
