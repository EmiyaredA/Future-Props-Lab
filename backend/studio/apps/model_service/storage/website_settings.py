"""Revisioned governance settings shared by resource allocation use cases."""

from studio.contracts.management.setting_owners import setting_owner
from studio.runtime.database.settings_records import SettingsPartition


def model_settings(session):
    return SettingsPartition(session, accepts=lambda key: setting_owner(key) == "models")


async def read_setting(session, key, default):
    return await model_settings(session).read(key, default)
