from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.core.outbound_urls import normalize_provider_base_url, normalize_provider_websocket_url
from app.schemas.model_supplier import ModelSupplierOut

ProviderKind = Literal[
    "openai",
    "anthropic",
    "senseaudio_image",
    "senseaudio_video",
    "senseaudio_asr",
    "senseaudio_realtime",
    "senseaudio_music",
    "senseaudio_sfx",
]
ModelCapability = Literal[
    "chat",
    "vision",
    "tools",
    "image_generation",
    "video_generation",
    "speech_recognition",
    "voice",
    "audio_generation",
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
    origin: Literal["user", "role_template"] = "user"
    template_key: str | None = None
    managed_fields: list[str] = Field(default_factory=list)
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
    supplier_id: str | None = None
    kind: ProviderKind
    base_url: str = Field(default="", max_length=512)
    api_key: str = ""
    enabled: bool = True

    @model_validator(mode="after")
    def valid_base_url(self) -> ProviderIn:
        self.base_url = (
            normalize_provider_websocket_url(self.base_url)
            if self.kind == "senseaudio_realtime"
            else normalize_provider_base_url(self.base_url)
        )
        return self


class ProviderOut(BaseModel):
    origin: Literal["user", "role_template"] = "user"
    template_key: str | None = None
    managed_fields: list[str] = Field(default_factory=list)
    id: str
    name: str
    supplier_id: str | None = None
    kind: ProviderKind
    base_url: str
    enabled: bool
    has_api_key: bool
    api_key_hint: str
    models: list[ModelEntryOut]


class ModelCatalogOut(BaseModel):
    default_model_ids: dict[str, str] = Field(default_factory=dict)
    revision: int
    suppliers: list[ModelSupplierOut] = Field(default_factory=list)
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


class ModelDefaultsIn(BaseModel):
    expected_revision: int = Field(ge=0)
    default_model_ids: dict[ModelCapability, str]
