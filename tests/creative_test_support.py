"""Explicit Creative resources rooted in each test's own temporary directory."""

from studio.apps.creative_workshop.catalog_resources import CreativeResources
from studio.apps.creative_workshop.storage.file_paths import (
    CreativeArchiveStaging,
    CreativeStorageSettings,
)


def isolated_resources(root, authors):
    settings = CreativeStorageSettings(root)
    return CreativeResources(authors, CreativeArchiveStaging(settings), settings)
