"""Stage files in the Galgame-only portable snapshot trust domain."""

from fpl_runtime.archive_transport import SnapshotFileDescription
from fpl_runtime.galgame_snapshot import ARCHIVE_PREFIX, GalgameArchiveManifest, archive_target

from ..galgame_archives import GalgameArchives
from .archive_http import archive_router

router = archive_router(
    prefix=ARCHIVE_PREFIX,
    archive_target=archive_target,
    auth_field="galgame_archive_auth",
    archive_factory=GalgameArchives,
    descriptor_type=SnapshotFileDescription,
    manifest_type=GalgameArchiveManifest,
    max_manifest_bytes=2 * 1024 * 1024,
)
