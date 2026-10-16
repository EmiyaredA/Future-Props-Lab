"""Workflow video parameters shared by generation entry points."""

from pydantic import BaseModel, Field


class WorkflowVideoParameters(BaseModel):
    model_config = {"extra": "forbid", "allow_inf_nan": False}

    megapixels: float | None = Field(default=None, ge=0.1, le=2)
    upscale_factor: float | None = Field(default=None, ge=1, le=2)
    width: int | None = Field(default=None, ge=256, le=2048, multiple_of=32)
    height: int | None = Field(default=None, ge=256, le=2048, multiple_of=32)
    seed: int | None = Field(default=None, ge=0, le=1125899906842624)


class WorkflowNumericParameterOut(BaseModel):
    default: int | float | None = None
    minimum: int | float
    maximum: int | float
    step: int | float


class WorkflowVideoCapabilitiesOut(BaseModel):
    reference_limits: dict[str, int]
    reference_mime_types: dict[str, list[str]] = Field(default_factory=dict)
    max_reference_bytes: int | None = None
    parameters: dict[str, WorkflowNumericParameterOut]
    supports_ratio: bool
    joint_audio: bool
