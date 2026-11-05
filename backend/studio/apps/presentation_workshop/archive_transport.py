"""Presentation's distinct archive trust domain and scoped staging route."""

from studio.apps.asset_library.clients.archive_transfer import ArchiveTransport as ArchiveExchange
from studio.contracts.presentation_workshop.presentation_archives import (
    DOMAIN,
    IMPORT,
    PREFIX,
    PURPOSE,
)
from studio.contracts.presentation_workshop.presentation_assets import PresentationAsset


class ArchiveTransport(ArchiveExchange):
    def __init__(self, capabilities, key):
        super().__init__(
            capabilities,
            key,
            service="presentation",
            purpose=PURPOSE,
            source_path=IMPORT,
            prefix=PREFIX,
            domain=DOMAIN,
            asset_model=PresentationAsset,
        )
