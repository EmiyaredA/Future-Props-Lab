"""Trusted-local provisioning for the cloud workspace."""

import asyncio
import os

import tomlkit
from fastapi import HTTPException

from studio.apps.identity.storage.cloud_access import enrolled
from studio.apps.management.config_updates import config_bytes, replace_config, revision
from studio.config import CONFIG_FILE
from studio.config.settings import get_cloud_settings

from .schemas import CloudSetup


def assert_setup_account(settings, owner):
    ids = set(filter(None, settings.fpl_cloud_control_admin_user_ids.split(os.pathsep)))
    if ids and owner not in ids:
        raise HTTPException(403, "该账号未获准管理云控配置")


async def probe_port(port, *, vnc=False):
    try:
        async with asyncio.timeout(1):
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            try:
                return not vnc or (await reader.readexactly(4)) == b"RFB "
            finally:
                writer.close()
    except (OSError, TimeoutError, EOFError):
        return False


async def read_setup(db, principal):
    raw = config_bytes(CONFIG_FILE)
    settings = get_cloud_settings()
    assert_setup_account(settings, principal.user_id)
    has_factor = await enrolled(db, principal.user_id)
    await db.rollback()
    return await read_snapshot(CONFIG_FILE, raw, settings, has_factor)


async def read_snapshot(path, raw, settings, has_factor):
    guacd, sharing = await asyncio.gather(
        probe_port(settings.fpl_cloud_control_guacd_port),
        probe_port(settings.fpl_cloud_control_vnc_port, vnc=True),
    )
    if config_bytes(path) != raw:
        raise HTTPException(409, "配置已变更，请刷新后重试")
    return CloudSetup(
        revision=revision(raw),
        host_label=settings.fpl_cloud_control_host_label,
        enabled=settings.fpl_cloud_control_enabled,
        public_enabled=settings.fpl_cloud_control_public_enabled,
        public_desktop_vnc_only=settings.fpl_cloud_control_public_desktop_vnc_only,
        enrolled=has_factor,
        guacd_ready=guacd,
        screen_sharing_ready=(
            sharing
            if settings.fpl_cloud_control_vnc_host in {"127.0.0.1", "host.docker.internal"}
            else None
        ),
    )


async def save_setup(db, principal, body):
    settings = get_cloud_settings()
    assert_setup_account(settings, principal.user_id)
    owner = principal.user_id
    if body.public_enabled and not await enrolled(db, owner):
        raise HTTPException(409, "请先在本机登记验证器")
    await db.rollback()
    await asyncio.to_thread(replace_config, CONFIG_FILE, body.revision, setup_edit(owner, body))
    return await read_setup(db, principal)


def setup_edit(owner, body):
    label = body.host_label.strip()
    if not label:
        raise HTTPException(422, "请填写主机名称")

    def edit(document):
        cloud = document.setdefault("cloud_control", tomlkit.table())
        cloud["enabled"] = True
        cloud["public_enabled"] = body.public_enabled
        cloud["host_label"] = label
        cloud["admin_user_ids"] = list(dict.fromkeys([*cloud.get("admin_user_ids", []), owner]))
        cloud.pop("vnc_password", None)

    return edit
