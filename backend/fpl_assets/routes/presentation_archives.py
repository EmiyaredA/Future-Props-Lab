"""Digest-bound Presentation staging on a separate peer trust domain."""

from fpl_runtime.model_outputs import ModelOutputDescription
from fpl_runtime.presentation_archives import (
    MAX_BYTES,
    PREFIX,
    PresentationManifest,
    archive_target,
)

from ..presentation_archives import PresentationArchives
from .archive_http import archive_router

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
