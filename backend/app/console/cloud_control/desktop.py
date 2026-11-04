"""Compatibility-site bindings for the shared Guacamole bridge."""

import asyncio

from app.runtime.config import get_cloud_settings
from app.runtime.db import SessionLocal
from fpl_runtime.cloud_authority import DESKTOP_COOKIE as DESKTOP_COOKIE
from fpl_runtime.cloud_authority import DESKTOP_SOCKET as DESKTOP_SOCKET

from . import desktop_bridge
from .access import desktop_authorized
from .desktop_bridge import DesktopInput as DesktopInput
from .desktop_bridge import GuacdReader as GuacdReader
from .desktop_bridge import handshake as handshake
from .desktop_bridge import instruction as instruction
from .desktop_bridge import parse_instruction as parse_instruction
from .preferences import desktop_preferences


async def _access(principal, local, _context=None, _epoch=None):
    async with SessionLocal() as db:
        if not await desktop_authorized(db, principal, local=local):
            return None
        minutes, _revision = await desktop_preferences(db, principal.user_id)
        return minutes


async def watch_access(principal, local, inputs, changed):
    async def check():
        return await _access(principal, local)

    return await desktop_bridge.watch_access(inputs, changed, check)


async def _dial(settings):
    return await asyncio.open_connection("127.0.0.1", settings.fpl_cloud_control_guacd_port)


class DesktopConnection(desktop_bridge.DesktopConnection):
    def __init__(self):
        super().__init__(settings=get_cloud_settings, access=_access, connect_upstream=_dial)
