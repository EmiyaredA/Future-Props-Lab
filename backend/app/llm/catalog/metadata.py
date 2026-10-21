PROVIDER_DEFAULT_CATEGORIES: dict[str, tuple[str, ...]] = {
    "local_qwen_tts": ("speech_synthesis",),
    "volcengine_image": ("image_generation",),
    "senseaudio_image": ("image_generation",),
    "volcengine_video": ("video_generation",),
    "senseaudio_video": ("video_generation",),
    "zealman_video": ("video_generation",),
    "senseaudio_asr": ("speech_recognition",),
    "senseaudio_asr_pro": ("speech_recognition",),
    "senseaudio_realtime": ("end_to_end_speech",),
    "senseaudio_music": ("music_generation",),
    "senseaudio_sfx": ("music_generation",),
}


def categories_for_provider(kind: str) -> list[str]:
    return list(PROVIDER_DEFAULT_CATEGORIES.get(kind, ("text_generation",)))
