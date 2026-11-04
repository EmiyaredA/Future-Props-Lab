"""Credential-free model discovery used by Visual."""

from typing import Literal

from pydantic import BaseModel, Field

from .provider_types import ProviderKind
from .video_capabilities import VideoCapabilitiesOut
from .workflow_video import WorkflowVideoCapabilitiesOut


class GenerationModelOptionOut(BaseModel):
    id: str
    provider_id: str
    provider_name: str
    kind: Literal["image", "video", "audio"]
    slug: str
    label: str
    description: str
    sizes: list[str] = Field(default_factory=list)
    max_reference_images: int = 1
    supports_seed: bool | None = True
    max_prompt_length: int | None = 2000
    video_capabilities: VideoCapabilitiesOut | None = None
    workflow_capabilities: WorkflowVideoCapabilitiesOut | None = None
    reference_mime_types: list[str] = Field(
        default_factory=lambda: ["image/jpeg", "image/png", "image/webp"]
    )


class GenerationOptionsOut(BaseModel):
    models: list[GenerationModelOptionOut]


class AcceptanceModelOut(BaseModel):
    id: str
    label: str
    slug: str
    provider_name: str
    provider_kind: ProviderKind


class AcceptanceModelListOut(BaseModel):
    items: list[AcceptanceModelOut]
