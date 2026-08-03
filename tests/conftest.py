import os
import shutil
import tempfile
from pathlib import Path

os.environ.setdefault("FPL_SECRETS_KEY", "Q3kT62dvbHHXXulO5XPCR84_yXK6t-6LXz7BcIYONys=")
TEST_RUNTIME_DIR = Path(tempfile.mkdtemp(prefix="future-props-tests-"))
TEST_DATABASE_PATH = TEST_RUNTIME_DIR / "future-props-test.db"
os.environ["FPL_DATABASE_PATH"] = str(TEST_DATABASE_PATH)

from db.migrations import apply_migrations  # noqa: E402

apply_migrations(TEST_DATABASE_PATH)


def pytest_sessionfinish() -> None:
    shutil.rmtree(TEST_RUNTIME_DIR, ignore_errors=True)
