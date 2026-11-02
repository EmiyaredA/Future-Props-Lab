"""Explicit catalog assembly for the migration-period single-database website."""

from .legacy_defaults import LegacyCatalogDefaults
from .legacy_usage import LegacyCatalogTaskUsage
from .service import ModelCatalogService


def legacy_catalog(session):
    return ModelCatalogService(
        session,
        task_usage=LegacyCatalogTaskUsage(session),
        defaults_store=LegacyCatalogDefaults(session),
    )
