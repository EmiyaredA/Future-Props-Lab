"""Read and change the approved app catalog on the Mac that owns the config."""

import asyncio
import os
import re
from pathlib import Path

import tomlkit
from fastapi import HTTPException

from studio.apps.management.config_updates import config_bytes, replace_config, revision
from studio.config.settings import Settings
from studio.contracts.remote_desktop.apps import InstalledRemoteApps, SaveRemoteApps
from studio.contracts.remote_desktop.setup import APP_SAVE
from studio.host.remote_apps.bridge import HostUnavailable, installed_apps


def allowed_ids(settings):
    return [
        value
        for value in settings.fpl_cloud_control_apps_allowed.split(os.pathsep)
        if re.fullmatch("[a-f0-9]{64}", value)
    ]


def available(settings):
    host = Path(settings.fpl_cloud_control_apps_host)
    return (
        settings.fpl_cloud_control_apps_enabled
        and host.is_absolute()
        and host.is_file()
        and os.access(host, os.X_OK)
    )


async def snapshot(config, *, operation, payload, authorize):
    raw = config_bytes(config)
    settings = Settings(_config_file=config, _read_environment=False)
    if not settings.fpl_cloud_control_apps_enabled:
        raise HTTPException(404, "远程应用尚未启用")
    try:
        apps = await installed_apps(settings.fpl_cloud_control_apps_host)
    except HostUnavailable as exc:
        raise HTTPException(503, str(exc)) from None
    if config_bytes(config) != raw:
        raise HTTPException(409, "配置已变更，请刷新应用列表")
    ids = allowed_ids(settings)
    if operation == APP_SAVE:
        body = SaveRemoteApps.model_validate(payload)
        current = set(ids) | {app.id for app in apps}
        if len(set(body.app_ids)) != len(body.app_ids) or not set(body.app_ids) <= current:
            raise HTTPException(422, "应用列表包含无效或重复的应用")
        loop = asyncio.get_running_loop()

        def edit(document):
            asyncio.run_coroutine_threadsafe(authorize(), loop).result(5)
            document.setdefault("cloud_control", tomlkit.table())["apps_allowed"] = body.app_ids

        await asyncio.to_thread(replace_config, config, body.revision, edit)
        ids = body.app_ids
        raw = config_bytes(config)
        saved = Settings(_config_file=config, _read_environment=False)
        if allowed_ids(saved) != ids or config_bytes(config) != raw:
            raise HTTPException(409, "配置已变更，请刷新应用列表")
    else:
        await authorize()
    return InstalledRemoteApps(revision=revision(raw), apps=apps, allowed_ids=ids)
