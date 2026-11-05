"""Digest-bound Presentation staging on a separate peer trust domain."""

from studio.apps.asset_library.presentation_archives import PresentationArchives
from studio.apps.asset_library.transport.service.archive_http import archive_router
from studio.contracts.presentation_workshop.presentation_archives import (
    MAX_BYTES,
    PREFIX,
    PresentationManifest,
    archive_target,
)
from studio.runtime.files.signed_payloads import ModelOutputDescription

router = archive_router(
    prefix=PREFIX,
    archive_target=archive_target,
    auth_field="presentation_archive_auth",
    archive_factory=PresentationArchives,
    descriptor_type=ModelOutputDescription,
    manifest_type=PresentationManifest,
    max_manifest_bytes=4 * 1024 * 1024,
    max_file_bytes=MAX_BYTES,
)
