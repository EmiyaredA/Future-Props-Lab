"""Path-free, allowlisted Models/Mac protocol; no credentials belong in job payloads."""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from studio.config.local_models import LOCAL_VIDEO_MODEL_IDS, ZONOS_MODEL_ID, definition
from studio.contracts.model_service.schemas.local_models import (
    SpeechSynthesisParameters,
    ZonosSynthesisParameters,
)

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
    reference_text: str = Field(default="", max_length=2000)
    synthesis_options: dict = Field(default_factory=dict)
    reference_asset_id: str = Field(min_length=1, max_length=36)
    reference_filename: str = Field(pattern=r"^reference\.(wav|mp3|m4a|ogg)$")
    reference_byte_size: int = Field(ge=1, le=20 * 1024**2)
    reference_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("model_id")
    @classmethod
    def allowed(cls, value):
        definition(value)
        if value in LOCAL_VIDEO_MODEL_IDS:
            raise ValueError("模型不支持语音合成")
        return value

    @model_validator(mode="after")
    def synthesis_valid(self):
        self.parameters()
        return self

    def parameters(self):
        cls = (
            ZonosSynthesisParameters
            if self.model_id == ZONOS_MODEL_ID
            else SpeechSynthesisParameters
        )
        values = {
            key: getattr(self, key)
            for key in ("text", "language", "reference_asset_id", "reference_text")
        }
        if set(values) & set(self.synthesis_options):
            raise ValueError("语音选项不得覆盖任务输入")
        return cls.model_validate({**values, **self.synthesis_options}).model_dump()


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


def valid_synthesis_metrics(model_id, options, metrics):
    """Accept bounded native measurements and only the selected ZONOS controls."""
    if not isinstance(metrics, dict):
        return False
    measured = dict(metrics)
    if model_id == ZONOS_MODEL_ID:
        expected = {
            "clone_mode": options.get("clone_mode", "embedding"),
            "emotion": options.get("emotion", "neutral"),
            "seed": options.get("seed", 42),
        }
        for key, value in expected.items():
            if key in measured and measured.pop(key) != value:
                return False
        if "controls" in measured:
            controls = measured.pop("controls")
            emotion = expected["emotion"]
            if emotion == "neutral":
                if controls is not None:
                    return False
            elif not isinstance(controls, dict) or set(controls) != {"emotions." + emotion}:
                return False
            elif any(
                type(v) not in {int, float} or not math.isfinite(v) or not 0 <= v <= 8
                for v in controls.values()
            ):
                return False
    allowed = {
        "ok",
        "sample_rate",
        "duration_seconds",
        "elapsed_seconds",
        "peak_memory_bytes",
        "process_peak_memory_bytes",
    }
    return not (set(measured) - allowed) and all(
        type(value) in {int, float, bool} and math.isfinite(value) and value >= 0
        for value in measured.values()
    )
