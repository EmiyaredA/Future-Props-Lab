import os
import shutil
import tempfile
from pathlib import Path

import pytest

os.environ.setdefault("FPL_SECRETS_KEY", "Q3kT62dvbHHXXulO5XPCR84_yXK6t-6LXz7BcIYONys=")
TEST_RUNTIME_DIR = Path(tempfile.mkdtemp(prefix="future-props-tests-"))
TEST_DATABASE_PATH = TEST_RUNTIME_DIR / "future-props-test.db"
os.environ["FPL_DATABASE_PATH"] = str(TEST_DATABASE_PATH)

from db.migrations import apply_migrations  # noqa: E402

apply_migrations(TEST_DATABASE_PATH)


@pytest.fixture(autouse=True)
def authenticated_business_routes(request: pytest.FixtureRequest):
    """Keep existing business tests focused while auth has dedicated matrix tests."""
    if request.node.get_closest_marker("real_auth"):
        yield
        return
    from app.accounts.principal import StudioPrincipal
    from app.core.tenant_context import bind_workspace
    from app.deps import SessionDep, require_studio_auth
    from app.main import app

    async def principal(session: SessionDep) -> StudioPrincipal:
        bind_workspace(session, "default")
        return StudioPrincipal(
            user_id="test-user",
            workspace_id="default",
            membership_id="test-membership",
            workspace_access="owner",
            member_role="owner",
            is_platform_admin=True,
            must_change_password=False,
            auth_kind="session",
            scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
            session_id="test-session",
        )

    app.dependency_overrides[require_studio_auth] = principal
    try:
        yield
    finally:
        app.dependency_overrides.pop(require_studio_auth, None)


def pytest_sessionfinish() -> None:
    shutil.rmtree(TEST_RUNTIME_DIR, ignore_errors=True)
