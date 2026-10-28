"""Provider-neutral video generation options shared by all entry points."""

from pydantic import BaseModel, Field


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
    supported_modes: list[str] = Field(default_factory=lambda: ["text", "frames", "reference"])
    reference_minimums: dict[str, int] = Field(default_factory=dict)
    reference_mime_types: dict[str, list[str]] = Field(default_factory=dict)
    supports_prompt: bool = True
    prompt_required: bool = False
    max_prompt_length: int = 6000
    supports_duration: bool = True
    duration_label: str = "时长"
    supports_ratio: bool = True
    supports_watermark: bool = True
    supports_generate_audio: bool = True
    supports_seed: bool = False
    seed_minimum: int = 0
    seed_maximum: int = 999999999999999
    default_resolution: str | None = None
    default_ratio: str | None = None
    resolution_ratios: dict[str, list[str]] = Field(default_factory=dict)
