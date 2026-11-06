"""Website composition is explicit and does not own process-global storage."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_import_and_schema_export_do_not_read_config_or_create_engine():
    code = """
import sqlalchemy.ext.asyncio
from sqlalchemy import event
from sqlalchemy.orm import Session
import studio.config

def forbidden(*args, **kwargs):
    raise AssertionError('schema import accessed configuration or database')

studio.config.read_config = forbidden
sqlalchemy.ext.asyncio.create_async_engine = forbidden
from studio.assembly.website import application, models
from studio.assembly.website.http import create_http_app
schema = create_http_app().openapi()
assert '/v1/interview-assistant/rooms' in schema['paths']
assert not hasattr(application, 'app')
assert not event.contains(Session, 'before_flush', models._assign_owner)
assert event.contains(models.WebsiteSession, 'before_flush', models._assign_owner)
"""
    environment = {**os.environ, "PYTHONPATH": str(ROOT / "backend") + os.pathsep + str(ROOT)}
    subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=environment, check=True)


@pytest.mark.asyncio
async def test_two_factories_own_separate_storage_and_lifecycle_components(tmp_path):
    from studio.assembly.website.application import create_app
    from studio.config.settings import Settings

    apps = [
        create_app(Settings(fpl_database_path=str(tmp_path / name))) for name in ("a.db", "b.db")
    ]
    try:
        first, second = apps
        for component in (
            "database",
            "auth_attempts",
            "amadeus_actions",
            "demo_runtime",
            "video_downloads",
            "cloud_desktop",
        ):
            assert getattr(first.state, component) is not getattr(second.state, component)
        assert (
            first.state.database.sessions.kw["bind"]
            is not second.state.database.sessions.kw["bind"]
        )
        assert first.state.auth_attempts.allow("login:owner", 1)
        assert not first.state.auth_attempts.allow("login:owner", 1)
        assert second.state.auth_attempts.allow("login:owner", 1)
        # Constructing the engine is lazy: no connection or database file exists yet.
        assert not (tmp_path / "a.db").exists()
        assert not (tmp_path / "b.db").exists()
        await first.state.video_downloads.close()
        assert not second.state.video_downloads.closed
    finally:
        for app in apps:
            await app.state.database.engine.dispose()
