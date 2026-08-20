from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator

ProviderKind = Literal[
    "openai", "anthropic", "senseaudio_image", "senseaudio_video", "senseaudio_asr"
]
ModelCapability = Literal[
    "chat",
    "vision",
    "tools",
    "image_generation",
    "video_generation",
    "speech_recognition",
]
ModelCategory = Literal[
    "text_generation",
    "other_general",
    "speech_synthesis",
    "speech_recognition",
    "music_generation",
    "video_generation",
    "image_generation",
    "end_to_end_speech",
]


class ModelEntryIn(BaseModel):
    expected_catalog_revision: int = Field(ge=0)
    slug: str = Field(min_length=1, max_length=160)
    label: str = Field(default="", max_length=160)
    description: str = Field(default="", max_length=255)
    capabilities: list[ModelCapability] = Field(default_factory=lambda: ["chat"])
    categories: list[ModelCategory] = Field(default_factory=list)
    enabled: bool = True


class ModelEntryOut(BaseModel):
    id: str
    provider_id: str
    slug: str
    label: str
    description: str
    capabilities: list[ModelCapability]
    categories: list[ModelCategory]
    enabled: bool


class ProviderIn(BaseModel):
    expected_catalog_revision: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=120)
    kind: ProviderKind
    base_url: str = Field(default="", max_length=512)
    api_key: str = ""
    enabled: bool = True

    @field_validator("base_url")
    @classmethod
    def valid_base_url(cls, value: str) -> str:
        raw = value.strip()
        if not raw:
            return raw
        HttpUrl(raw)
        return raw.rstrip("/")


class ProviderOut(BaseModel):
    id: str
    name: str
    kind: ProviderKind
    base_url: str
    enabled: bool
    has_api_key: bool
    api_key_hint: str
    models: list[ModelEntryOut]


class ModelCatalogOut(BaseModel):
    revision: int
    providers: list[ProviderOut]


class ProviderEnabledIn(BaseModel):
    expected_catalog_revision: int = Field(ge=0)
    enabled: bool


class TestModelOut(BaseModel):
    ok: bool
    log_id: str
    output: str
    latency_ms: int


class ProviderMutationOut(BaseModel):
    revision: int
    provider: ProviderOut


class ModelMutationOut(BaseModel):
    revision: int
    model: ModelEntryOut


class DeleteMutationOut(BaseModel):
    deleted: bool
    revision: int


class ModelCategoryOut(BaseModel):
    id: ModelCategory
    label: str
    type: Literal["text", "image", "audio", "video"]
    sub_type: str | None = None


class ModelCategoryListOut(BaseModel):
    items: list[ModelCategoryOut]
