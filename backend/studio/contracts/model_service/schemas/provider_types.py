"""Provider identifiers shared by model and workshop HTTP schemas."""

from typing import Literal

ProviderKind = Literal[
    "local_qwen_tts",
    "local_relayvsr",
    "local_ffmpeg",
    "volcengine_image",
    "openai",
    "deepseek",
    "anthropic",
    "senseaudio_image",
    "volcengine_video",
    "senseaudio_video",
    "zealman_video",
    "autodl_video",
    "senseaudio_asr",
    "senseaudio_asr_pro",
    "senseaudio_realtime",
    "senseaudio_music",
    "senseaudio_sfx",
]

DEEPSEEK_BASE_URL = "https://api.deepseek.com"
