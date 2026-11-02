from __future__ import annotations

from pydantic import BaseModel

from app.llm.schemas.model_service import ProviderKind


class RealtimeVoiceOptionOut(BaseModel):
    value: str
    label: str


class RealtimeNumberParameterOut(BaseModel):
    default: float
    minimum: float
    maximum: float
    step: float


class RealtimeVoiceVadOut(BaseModel):
    positive_speech_threshold: RealtimeNumberParameterOut
    negative_speech_threshold: RealtimeNumberParameterOut
    min_speech_ms: RealtimeNumberParameterOut
    pre_speech_pad_ms: RealtimeNumberParameterOut
    commit_silence_ms: RealtimeNumberParameterOut


class RealtimeVoicePlaybackOut(BaseModel):
    start_buffer_ms: RealtimeNumberParameterOut
    recovery_buffer_ms: RealtimeNumberParameterOut


class RealtimeVoiceMicrophoneOut(BaseModel):
    echo_cancellation: bool
    noise_suppression: bool
    auto_gain_control: bool


class RealtimeVoiceModelOut(BaseModel):
    id: str
    provider_id: str
    provider_name: str
    provider_kind: ProviderKind
    slug: str
    label: str
    voices: list[RealtimeVoiceOptionOut]
    default_voice: str
    input_sample_rate: int
    output_sample_rate: int
    commit_silence_ms: int
    supports_interruption: bool
    instructions_max_chars: int
    greeting_max_chars: int
    input_format: str
    output_format: str
    channels: int
    client_vad: RealtimeVoiceVadOut
    playback: RealtimeVoicePlaybackOut
    microphone: RealtimeVoiceMicrophoneOut


class RealtimeVoiceOptionsOut(BaseModel):
    models: list[RealtimeVoiceModelOut]
