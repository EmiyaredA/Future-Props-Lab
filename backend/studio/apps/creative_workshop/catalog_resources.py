"""Explicit resources for the existing SQL catalog adapter, owned by its assembly."""

from dataclasses import dataclass

from studio.apps.creative_workshop.catalog_archives import CreativeArchives
from studio.apps.creative_workshop.catalog_authors import CreativeAuthors
from studio.apps.creative_workshop.catalog_sources import CreativeSources
from studio.apps.creative_workshop.storage.catalog_files import CreativeFileSettings


@dataclass(frozen=True)
class CreativeResources:
    authors: CreativeAuthors
    archives: CreativeArchives
    settings: CreativeFileSettings
    sources: CreativeSources | None = None
