"""Explicit catalog assembly for the migration-period single-database website."""

from studio.apps.model_service.catalog.legacy_defaults import LegacyCatalogDefaults
from studio.apps.model_service.catalog.legacy_usage import LegacyCatalogTaskUsage
from studio.apps.model_service.catalog.service import ModelCatalogService


def legacy_catalog(session, *, cipher):
    return ModelCatalogService(
        session,
        task_usage=LegacyCatalogTaskUsage(session),
        defaults_store=LegacyCatalogDefaults(session),
        cipher=cipher,
    )
