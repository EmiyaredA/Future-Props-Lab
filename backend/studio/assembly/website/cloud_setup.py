"""Trusted-local provisioning for the cloud workspace."""

import asyncio

from studio.apps.management.config_updates import config_bytes, replace_config
from studio.config import CONFIG_FILE
from studio.config.settings import get_cloud_settings
from studio.host.deployment.cloud_setup import assert_setup_account, read_snapshot, setup_edit


async def read_setup(principal):
    raw = config_bytes(CONFIG_FILE)
    settings = get_cloud_settings()
    assert_setup_account(settings, principal.user_id)
    return await read_snapshot(CONFIG_FILE, raw, settings)


async def save_setup(principal, body):
    settings = get_cloud_settings()
    assert_setup_account(settings, principal.user_id)
    owner = principal.user_id
    await asyncio.to_thread(replace_config, CONFIG_FILE, body.revision, setup_edit(owner, body))
    return await read_setup(principal)
