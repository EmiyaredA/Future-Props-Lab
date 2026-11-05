"""Audio source admission shared by creation and saved-segment operations."""

from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.contracts.asset_library.annotation import MAX_AUDIO_BYTES

MAX_DURATION_MS = 60 * 60 * 1000


def require_audio(value):
    if value is None:
        raise AudioAnnotationError("音频文件不存在", code="not_found", status=404)
    if value.description.media_kind != "audio":
        raise AudioAnnotationError("标注任务只能使用音频文件", code="invalid_audio")
    if value.byte_size > MAX_AUDIO_BYTES:
        raise AudioAnnotationError("音频不能超过 100 MiB", code="audio_too_large", status=413)
    return value


def require_duration(value):
    if value <= 0:
        raise AudioAnnotationError("音频时长无效", code="audio_metadata_invalid")
    if value > MAX_DURATION_MS:
        raise AudioAnnotationError("音频不能超过 60 分钟", code="audio_too_long", status=413)
    return value
