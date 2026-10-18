"""Provider-neutral video generation options shared by all entry points."""

from pydantic import BaseModel


class VideoCapabilitiesOut(BaseModel):
    duration_min: int = 4
    duration_max: int
    supports_auto_duration: bool = True
    resolutions: list[str]
    ratios: list[str]
    reference_limits: dict[str, int]
    audio_only: bool = False
    frames_require_adaptive_ratio: bool = False
    default_generate_audio: bool = True
    reference_video_upload_configured: bool = False
