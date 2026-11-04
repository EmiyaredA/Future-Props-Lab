"""Presentation's distinct archive trust domain and scoped staging route."""

from fpl_runtime.archive_transport import ArchiveTransport as ArchiveExchange
from fpl_runtime.presentation_archives import DOMAIN, IMPORT, PREFIX, PURPOSE
from fpl_runtime.presentation_assets import PresentationAsset


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
