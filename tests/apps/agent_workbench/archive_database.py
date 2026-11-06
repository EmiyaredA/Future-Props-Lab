"""Exercise the retired workbench schema without registering a live service."""

from studio.apps.agent_workbench.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.agent_workbench.application import MODELS
from studio.runtime.database import sessions
from studio.runtime.database.migrations import apply


def open_archive(tmp_path, monkeypatch):
    original_lookup = sessions.service_by_id

    def archive_lookup(service):
        if service != "agents":
            return original_lookup(service)

    with monkeypatch.context() as patch:
        patch.setattr(sessions, "service_by_id", archive_lookup)
        database = sessions.Database("agents", tmp_path, models=MODELS)
    apply(database.path, "agents", MIGRATIONS)
    return database
