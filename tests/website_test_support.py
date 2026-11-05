"""The test suite, not production imports, owns this isolated website instance."""

import os

from studio.assembly.website.application import create_app
from studio.config.settings import get_settings

if not os.environ.get("FPL_CONFIG_FILE") or not os.environ.get("FPL_DATABASE_PATH"):
    raise RuntimeError("Website tests require explicit isolated configuration and database")
settings = get_settings()
app = create_app(settings)
database = app.state.database
SessionLocal = database.sessions
engine = database.engine
