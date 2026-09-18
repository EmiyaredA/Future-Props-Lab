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
def authenticated_business_routes(request: pytest.FixtureRequest, monkeypatch):
    """Override auth only for test modules that explicitly imported the ASGI app.

    Pure unit and architecture tests must not import ``app.main`` as a side effect of
    global test setup; this keeps configuration tests independent from application
    startup settings.
    """
    if request.node.get_closest_marker("real_auth") or "app.main" not in sys.modules:
        yield
        return
    from app.capabilities.identity.principal import StudioPrincipal
    from app.console.governance.platform_policy import CAPABILITIES
    from app.deps import SessionDep, require_studio_auth
    from app.main import app
    from app.orm import bind_workspace
    from app.llm.routes.model_capacity import model_capacity

    async def principal(session: SessionDep) -> StudioPrincipal:
        bind_workspace(session, "default")
        return StudioPrincipal(
            user_id="test-user",
            workspace_id="default",
            membership_id="test-membership",
            workspace_access="owner",
            member_role="owner",
            is_platform_admin=True,
            platform_role="super_admin",
            platform_permissions=frozenset(CAPABILITIES),
            must_change_password=False,
            auth_kind="session",
            scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
            session_id="test-session",
        )

    async def capacity():
        yield

    from app.llm.routes.models import model_test_realtime

    async def acquire_capacity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(model_test_realtime, "acquire", acquire_capacity)
    app.dependency_overrides[model_capacity] = capacity
    app.dependency_overrides[require_studio_auth] = principal
    try:
        yield
    finally:
        app.dependency_overrides.pop(require_studio_auth, None)
        app.dependency_overrides.pop(model_capacity, None)


def pytest_sessionfinish() -> None:
    shutil.rmtree(TEST_RUNTIME_DIR, ignore_errors=True)
