"""Trusted-local provisioning for the cloud workspace."""

import asyncio

from fastapi import HTTPException

from studio.apps.identity.storage.cloud_access import enrolled
from studio.apps.management.config_updates import config_bytes, replace_config
from studio.config import CONFIG_FILE
from studio.config.settings import get_cloud_settings
from studio.host.deployment.cloud_setup import assert_setup_account, read_snapshot, setup_edit


async def read_setup(db, principal):
    raw = config_bytes(CONFIG_FILE)
    settings = get_cloud_settings()
    assert_setup_account(settings, principal.user_id)
    has_factor = await enrolled(db, principal.user_id)
    await db.rollback()
    return await read_snapshot(CONFIG_FILE, raw, settings, has_factor)


async def save_setup(db, principal, body):
    settings = get_cloud_settings()
    assert_setup_account(settings, principal.user_id)
    owner = principal.user_id
    if body.public_enabled and not await enrolled(db, owner):
        raise HTTPException(409, "请先在本机登记验证器")
    await db.rollback()
    await asyncio.to_thread(replace_config, CONFIG_FILE, body.revision, setup_edit(owner, body))
    return await read_setup(db, principal)
