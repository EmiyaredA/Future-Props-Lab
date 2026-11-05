"""Path-free, allowlisted Models/Mac protocol; no credentials belong in job payloads."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.llm.local_models.manifest import definition

OPERATIONS = frozenset(
    "models." + name
    for name in ("install", "repair", "cancel", "enable", "stop", "uninstall", "synthesize")
)


class ModelObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str
    installed: bool
    loaded: bool = False
    busy: bool = False
    installing: bool = False
    progress: int = Field(default=0, ge=0, le=100)

    @field_validator("model_id")
    @classmethod
    def allowed(cls, value):
        definition(value)
        return value


class ModelsObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    compatible: bool
    models: list[ModelObservation] = Field(max_length=20)


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str
    task_id: str = Field(min_length=1, max_length=36)
    text: str = Field(min_length=1, max_length=2000)
    language: str = Field(min_length=1, max_length=40)
    reference_text: str = Field(min_length=1, max_length=2000)
    reference_asset_id: str = Field(min_length=1, max_length=36)
    reference_filename: str = Field(pattern=r"^reference\.(wav|mp3|m4a|ogg)$")
    reference_byte_size: int = Field(ge=1, le=20 * 1024**2)
    reference_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("model_id")
    @classmethod
    def allowed(cls, value):
        definition(value)
        return value


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str
    action: Literal["install", "repair", "cancel", "enable", "stop", "uninstall"]
    target_revision: int = Field(ge=1)
    enable_on_completion: bool = False

    @field_validator("model_id")
    @classmethod
    def allowed(cls, value):
        definition(value)
        return value
