"""Run the fixed video extractor inside one private worker-owned job directory."""

import shutil
from pathlib import Path
from uuid import UUID

from studio.contracts.tools.tools_video import VideoDownloadInput, VideoDownloadResult
from studio.contracts.tools.video_errors import VideoDownloadError
from studio.contracts.tools.video_sources import validate_video_url
from studio.host.project_files.video_execution import (
    MIME_BY_EXTENSION,
    _find_media,
    _read_title,
    _run_yt_dlp,
    _safe_filename,
)


class VideoWorkspace:
    def __init__(self, state_root: Path, *, download=_run_yt_dlp):
        root = state_root / "video-jobs"
        if root.is_symlink():
            raise ValueError("视频工作目录不能是符号链接")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root, self.download = root.resolve(), download

    def _job_root(self, job_id):
        return self.root / str(UUID(str(job_id)))

    def execute(self, job_id, payload):
        source = VideoDownloadInput.model_validate(payload)
        url = validate_video_url(source.url)
        job = self._job_root(job_id)
        work = job / "work"
        job.mkdir(mode=0o700)
        work.mkdir(mode=0o700)
        self.download(
            url=url,
            quality=source.quality,
            work_dir=work,
            cookies_from_browser=source.cookies_from_browser,
        )
        media = _find_media(work)
        if media.is_symlink() or not media.resolve().is_relative_to(work.resolve()):
            raise VideoDownloadError("下载产物路径无效", code="file_unavailable")
        title = (_read_title(work, media.stem).strip() or media.stem)[:500]
        suffix = media.suffix.lower()
        result = job / "media"
        media.rename(result)
        return VideoDownloadResult.from_file(
            result,
            title=title,
            filename=_safe_filename(title, suffix),
            mime_type=MIME_BY_EXTENSION[suffix],
        )

    def result_path(self, job_id, result):
        job = self._job_root(job_id)
        path = job / "media"
        if (
            job.is_symlink()
            or path.is_symlink()
            or not path.is_file()
            or not path.resolve().is_relative_to(self.root)
            or VideoDownloadResult.from_file(
                path, title=result.title, filename=result.filename, mime_type=result.mime_type
            )
            != result
        ):
            raise VideoDownloadError("下载产物与持久回执不匹配", code="file_unavailable")
        return path

    def forget(self, job_id):
        path = self._job_root(job_id)
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
