"""Private Video snapshot staging and publication after a source receipt."""

from anyio.to_thread import run_sync

from app.capabilities.asset_store.digests import sha256_file
from app.capabilities.asset_store.errors import AssetError
from fpl_runtime.video_snapshot import VideoArchiveManifest

from .models import VideoArchiveBatch, VideoArchiveFile
from .motion_archives import ScopedProjectArchives


class VideoArchives(ScopedProjectArchives):
    service = "video"
    project_column = "video_editor_project_id"
    manifest_type = VideoArchiveManifest
    batch_model = VideoArchiveBatch
    file_model = VideoArchiveFile
    allowed_extensions = None

    @property
    def batch_byte_limit(self):
        return self.settings.fpl_project_snapshot_max_bytes

    def file_limit(self):
        return self.batch_byte_limit

    async def normalize_staged(self, description, row, path):
        if (
            row.byte_size != description.byte_size
            or await run_sync(sha256_file, path) != description.content_sha256
        ):
            raise AssetError("归档文件内容已变化", code="archive_file_changed", status=422)
        row.display_name = description.display_name

    def asset_result(self, row):
        return {**super().asset_result(row), "display_name": row.display_name}
