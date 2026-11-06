"""Exercise the retired workbench schema without registering a live service."""

import json
from pathlib import Path

from studio.apps.agent_workbench.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.agent_workbench.application import MODELS
from studio.contracts.gateway.catalog import BY_ID, Service
from studio.contracts.gateway.routing import Operation, RouteCatalog
from studio.runtime.database import sessions
from studio.runtime.database.migrations import apply
from studio.runtime.http import dependencies


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


def archive_catalog(monkeypatch):
    monkeypatch.setitem(BY_ID, "agents", Service("agents", "Archived workbench"))
    entries = json.loads(Path(__file__).with_name("archived_operations.json").read_text())
    permissions = {item["operation_id"]: item.pop("permission") for item in entries}
    catalog = RouteCatalog(Operation(**item) for item in entries)
    production_permission = dependencies.route_permission

    def permission(method, path):
        match = catalog.match(method, path)
        return permissions[match.operation_id] if match else production_permission(method, path)

    monkeypatch.setattr(dependencies, "route_permission", permission)
    return catalog
