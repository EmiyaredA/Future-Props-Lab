"""Story asset media constraints shared by both deployments."""

from studio.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError

IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/avif"}
AUDIO_MIME_TYPES = {
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/x-m4a",
    "audio/ogg",
}
VIDEO_MIME_TYPES = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
}


def validate_story_asset_media(asset_type, media_kind, mime_type):
    if asset_type == "image" and (media_kind != "image" or mime_type not in IMAGE_MIME_TYPES):
        raise GalgameStoryDocumentInvalidError("故事图片素材必须引用静态图片")
    if asset_type == "audio" and (media_kind != "audio" or mime_type not in AUDIO_MIME_TYPES):
        raise GalgameStoryDocumentInvalidError("故事声音素材必须引用支持的音频文件")
    if asset_type == "video" and (media_kind != "video" or mime_type not in VIDEO_MIME_TYPES):
        raise GalgameStoryDocumentInvalidError("故事视频素材必须引用 MP4、WebM 或 MOV")
