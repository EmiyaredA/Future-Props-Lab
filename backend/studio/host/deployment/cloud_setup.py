"""Mac configuration and port probes with an explicit configuration path."""

import asyncio
import os
import sys
from pathlib import Path

import tomlkit
from fastapi import HTTPException

from studio.apps.management.config_updates import config_bytes, revision
from studio.contracts.remote_desktop.desktop import CloudSetup


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


async def read_snapshot(path, raw, settings):
    apps = settings.fpl_cloud_control_apps_enabled
    host = Path(settings.fpl_cloud_control_apps_host)
    guacd, sharing = (
        (False, None)
        if apps
        else await asyncio.gather(
            probe_port(settings.fpl_cloud_control_guacd_port),
            probe_port(settings.fpl_cloud_control_vnc_port, vnc=True),
        )
    )
    if config_bytes(path) != raw:
        raise HTTPException(409, "配置已变更，请刷新后重试")
    return CloudSetup(
        revision=revision(raw),
        host_label=settings.fpl_cloud_control_host_label,
        enabled=settings.fpl_cloud_control_enabled,
        public_enabled=settings.fpl_cloud_control_public_enabled,
        public_desktop_vnc_only=settings.fpl_cloud_control_public_desktop_vnc_only,
        guacd_ready=guacd,
        remote_apps_enabled=apps,
        remote_apps_host_ready=(
            apps
            and sys.platform == "darwin"
            and host.is_absolute()
            and host.is_file()
            and os.access(host, os.X_OK)
        ),
        screen_sharing_ready=(
            sharing
            if settings.fpl_cloud_control_vnc_host in {"127.0.0.1", "host.docker.internal"}
            else None
        ),
    )


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
