import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

os.environ.setdefault("FPL_SECRETS_KEY", "Q3kT62dvbHHXXulO5XPCR84_yXK6t-6LXz7BcIYONys=")
TEST_RUNTIME_DIR = Path(tempfile.mkdtemp(prefix="future-props-tests-"))
TEST_DATABASE_PATH = TEST_RUNTIME_DIR / "future-props-test.db"
os.environ["FPL_DATABASE_PATH"] = str(TEST_DATABASE_PATH)
os.environ["FPL_CONFIG_FILE"] = str(TEST_RUNTIME_DIR / "config.toml")

from db.migrations import apply_migrations  # noqa: E402

apply_migrations(TEST_DATABASE_PATH)


@pytest.fixture(autouse=True)
async def authenticated_business_routes(request: pytest.FixtureRequest, monkeypatch):
    """Override auth only for test modules that explicitly imported the ASGI app.

    Pure unit and architecture tests must not construct a website as a side effect
    of global test setup; this keeps configuration tests independent from application
    startup settings.
    """
    if request.node.get_closest_marker("real_auth") or "website_test_support" not in sys.modules:
        yield
        return
    from studio.apps.identity.storage.models.accounts import User
    from studio.apps.model_service.storage.models.model_service import ModelCatalogState
    from studio.apps.model_service.transport.website.model_capacity import model_capacity
    from studio.assembly.http_dependencies import SessionDep, require_studio_auth
    from studio.assembly.website.models import bind_owner
    from studio.contracts.identity.principal import StudioPrincipal
    from website_test_support import SessionLocal, app

    async with SessionLocal() as seed:
        if await seed.get(User, "test-user") is None:
            seed.add(
                User(
                    id="test-user",
                    username="test-fixture",
                    username_normalized="test-fixture",
                    password_hash="unused-test-hash",
                    platform_role="admin",
                )
            )
        if await seed.get(ModelCatalogState, "test-user") is None:
            seed.add(ModelCatalogState(owner_user_id="test-user", revision=0))
        await seed.commit()

    async def principal(session: SessionDep) -> StudioPrincipal:
        bind_owner(session, "test-user")
        return StudioPrincipal(
            user_id="test-user",
            platform_role="admin",
            must_change_password=False,
            auth_kind="session",
            scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
            session_id="test-session",
        )

    async def capacity():
        yield

    from dataclasses import replace

    async def acquire_capacity(*_args, **_kwargs):
        return None

    class BusinessMediaAccess:
        async def ensure_active(self):
            pass

    # This fixture already bypasses HTTP identity for business tests. Keep the
    # post-processing check under the same explicit bypass; real_auth tests use it.
    monkeypatch.setattr(app.state, "media_authorization", lambda _request: BusinessMediaAccess())

    monkeypatch.setattr(
        app.state, "model_admission", replace(app.state.model_admission, acquire=acquire_capacity)
    )
    app.dependency_overrides[model_capacity] = capacity
    app.dependency_overrides[require_studio_auth] = principal
    try:
        yield
    finally:
        app.dependency_overrides.pop(require_studio_auth, None)
        app.dependency_overrides.pop(model_capacity, None)


def pytest_sessionfinish() -> None:
    shutil.rmtree(TEST_RUNTIME_DIR, ignore_errors=True)


@pytest.fixture(autouse=True)
def explicit_thought_identity_adapter():
    """Direct legacy storage tests opt into the same explicit local Identity port."""
    if "website_test_support" not in sys.modules:
        yield
        return
    from studio.apps.thought_workshop.legacy_accounts import LegacyAccountDirectory
    from website_test_support import SessionLocal

    previous = dict(SessionLocal.kw.get("info") or {})

    SessionLocal.configure(
        info={
            **previous,
            "thought_directory_factory": LegacyAccountDirectory,
        }
    )
    try:
        yield
    finally:
        SessionLocal.configure(info=previous)
