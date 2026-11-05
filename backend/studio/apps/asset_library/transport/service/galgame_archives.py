"""Stage files in the Galgame-only portable snapshot trust domain."""

from studio.apps.asset_library.clients.archive_transfer import SnapshotFileDescription
from studio.apps.asset_library.galgame.galgame_archives import GalgameArchives
from studio.apps.asset_library.transport.service.archive_http import archive_router
from studio.contracts.galgame_workshop.galgame_snapshot import (
    ARCHIVE_PREFIX,
    GalgameArchiveManifest,
    archive_target,
)

router = archive_router(
    prefix=ARCHIVE_PREFIX,
    archive_target=archive_target,
    auth_field="galgame_archive_auth",
    archive_factory=GalgameArchives,
    descriptor_type=SnapshotFileDescription,
    manifest_type=GalgameArchiveManifest,
    max_manifest_bytes=2 * 1024 * 1024,
)
