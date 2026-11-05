"""Thought archive endpoints and the shared community upload staging boundary."""

from fpl_runtime.thought_archives import MAX_MANIFEST_BYTES, PREFIX, ArchiveManifest, archive_target
from fpl_runtime.thought_uploads import ThoughtUploadDescription

from ..thought_archives import ThoughtArchives
from .archive_http import archive_context, archive_router
from .archive_http import receipt as receipt
from .archive_http import require_active as require_active

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
