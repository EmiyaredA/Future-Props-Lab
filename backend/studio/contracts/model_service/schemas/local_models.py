from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from studio.config.local_models import LANGUAGES


class LocalModelActionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=64)
    expected_revision: int = Field(ge=0)
    action: Literal["install", "cancel", "enable", "stop", "uninstall", "repair"]


class LocalModelOut(BaseModel):
    id: str
    label: str
    capability: Literal["speech_synthesis", "video_enhancement"] = "speech_synthesis"
    repository: str
    license: str
    model_revision: str
    download_bytes: int
    required_disk_bytes: int
    compatible: bool
    status: str
    enabled: bool
    loaded: bool
    busy: bool
    progress: int
    error_message: str | None = None
    revision: int


class LocalModelsOut(BaseModel):
    items: list[LocalModelOut]
    can_manage: bool


class LocalModelAttachIn(BaseModel):
    expected_catalog_revision: int = Field(ge=0)
    model_id: str


class SpeechSynthesisParameters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)
    language: str = "Chinese"
    reference_asset_id: str
    reference_text: str = Field(min_length=1, max_length=2000)

    @field_validator("language")
    @classmethod
    def language_supported(cls, value):
        if value not in LANGUAGES:
            raise ValueError("不支持的合成语言")
        return value

    @field_validator("text", "reference_text")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("文本不能为空")
        return value


class ZonosSynthesisParameters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)
    language: Literal["Chinese", "English", "Japanese"] = "Chinese"
    reference_asset_id: str = Field(min_length=1)
    reference_text: str = Field(default="", max_length=2000)
    clone_mode: Literal["embedding", "reference"] = "embedding"
    emotion: Literal["neutral", "happy", "angry", "sad", "serene", "scared", "confused"] = "neutral"
    emotion_strength: float = Field(default=0.5, ge=0, le=1, allow_inf_nan=False)
    seed: int = Field(default=42, ge=0, le=2**32 - 1)

    @field_validator("text")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("文本不能为空")
        return value
