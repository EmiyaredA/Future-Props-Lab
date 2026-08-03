from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator

ProviderKind = Literal["openai", "anthropic"]
ModelCapability = Literal["chat", "vision", "tools"]


class ModelEntryIn(BaseModel):
    expected_catalog_revision: int = Field(ge=0)
    slug: str = Field(min_length=1, max_length=160)
    label: str = Field(default="", max_length=160)
    description: str = Field(default="", max_length=255)
    capabilities: list[ModelCapability] = Field(default_factory=lambda: ["chat"])
    enabled: bool = True


class ModelEntryOut(BaseModel):
    id: str
    provider_id: str
    slug: str
    label: str
    description: str
    capabilities: list[ModelCapability]
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
