"""Credential-free model discovery used by Visual."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from studio.contracts.model_service.workflow_video import WorkflowVideoCapabilitiesOut

from .provider_types import ProviderKind
from .video_capabilities import VideoCapabilitiesOut


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


class FixedAcceptanceModelOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: AcceptanceModelOut | None


class AcceptanceModelListOut(BaseModel):
    items: list[AcceptanceModelOut]


class VisualAssistantModelOptionOut(BaseModel):
    id: str
    provider_id: str
    provider_name: str
    slug: str
    label: str
    description: str
    capabilities: list[str]


class AssistantCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slugs: dict[str, str]
    options: list[VisualAssistantModelOptionOut]
    image: list[str]
    video: list[str]
