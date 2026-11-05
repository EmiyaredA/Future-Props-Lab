"""Private Video snapshot staging and publication after a source receipt."""

from fpl_runtime.video_snapshot import VideoArchiveManifest

from .models import VideoArchiveBatch, VideoArchiveFile
from .motion_archives import PortableProjectArchives


class VideoArchives(PortableProjectArchives):
    service = "video"
    project_column = "video_editor_project_id"
    manifest_type = VideoArchiveManifest
    batch_model = VideoArchiveBatch
    file_model = VideoArchiveFile
    allowed_extensions = None
