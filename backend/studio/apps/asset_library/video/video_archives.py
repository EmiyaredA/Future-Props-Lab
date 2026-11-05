"""Private Video snapshot staging and publication after a source receipt."""

from studio.apps.asset_library.motion.motion_archives import PortableProjectArchives
from studio.apps.asset_library.storage.service_models import VideoArchiveBatch, VideoArchiveFile
from studio.contracts.video_editor.video_snapshot import VideoArchiveManifest


class VideoArchives(PortableProjectArchives):
    service = "video"
    project_column = "video_editor_project_id"
    manifest_type = VideoArchiveManifest
    batch_model = VideoArchiveBatch
    file_model = VideoArchiveFile
    allowed_extensions = None
