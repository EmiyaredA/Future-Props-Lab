"""Thought archive endpoints and the shared community upload staging boundary."""

from studio.apps.asset_library.thought.thought_archives import ThoughtArchives
from studio.apps.asset_library.transport.service.archive_http import archive_context, archive_router
from studio.apps.asset_library.transport.service.archive_http import receipt as receipt
from studio.apps.asset_library.transport.service.archive_http import (
    require_active as require_active,
)
from studio.contracts.thought_workshop.thought_archives import (
    MAX_MANIFEST_BYTES,
    PREFIX,
    ArchiveManifest,
    archive_target,
)
from studio.contracts.thought_workshop.thought_uploads import ThoughtUploadDescription

AUTH_FIELD = "thought_archive_auth"
router = archive_router(
    prefix=PREFIX,
    archive_target=archive_target,
    auth_field=AUTH_FIELD,
    archive_factory=ThoughtArchives,
    descriptor_type=ThoughtUploadDescription,
    manifest_type=ArchiveManifest,
    max_manifest_bytes=MAX_MANIFEST_BYTES,
)


def context(request):
    return archive_context(request, AUTH_FIELD, ThoughtArchives)
