from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ModelTestTranscriptionParametersIn(BaseModel):
    language: str | None = Field(default=None, max_length=128)
    target_language: str | None = Field(default=None, max_length=64)
    enable_word_timestamps: bool | None = None
    enable_text_edit: bool | None = None
    enable_speaker_diarization: bool | None = None
    max_speakers: int | None = Field(default=None, ge=1, le=20)
    enable_punctuation: bool | None = None
    hotwords: str | None = Field(default=None, max_length=500)
    abbreviations: bool | None = None


class ModelTestTranscriptionParametersOut(BaseModel):
    language: str
    target_language: str | None
    enable_word_timestamps: bool
    enable_text_edit: bool
    enable_speaker_diarization: bool
    max_speakers: int | None
    enable_punctuation: bool
    hotwords: str | None
    abbreviations: bool


class ModelTestTranscriptionLanguageOptionOut(BaseModel):
    value: str
    label: str


class ModelTestTranscriptionParameterCapabilitiesOut(BaseModel):
    language_mode: Literal["select", "candidates"]
    language_options: list[ModelTestTranscriptionLanguageOptionOut]
    target_language_options: list[ModelTestTranscriptionLanguageOptionOut]
    supports_word_timestamps: bool = False
    supports_text_edit: bool = False
    supports_speaker_diarization: bool = False
    supports_max_speakers: bool = False
    supports_punctuation: bool = False
    supports_hotwords: bool = False
    supports_abbreviations: bool = False
    defaults: ModelTestTranscriptionParametersOut
