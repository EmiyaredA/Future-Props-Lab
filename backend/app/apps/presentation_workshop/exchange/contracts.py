from dataclasses import dataclass, field

from pydantic import Field

from app.apps.presentation_workshop.schemas.document import PresentationDocument
from app.apps.presentation_workshop.schemas.values import SlideModel


class ConversionIssue(SlideModel):
    slide_id: str | None = None
    element_id: str | None = None
    code: str
    message: str


class ImportPreview(SlideModel):
    title: str
    document: PresentationDocument
    issues: list[ConversionIssue] = Field(default_factory=list)
    preview_assets: dict[str, str] = Field(default_factory=dict)


class ExportPreview(SlideModel):
    revision: int
    issues: list[ConversionIssue]


@dataclass
class ImportedFile:
    filename: str
    mime_type: str
    content: bytes


@dataclass
class ParsedPresentation:
    title: str
    document: PresentationDocument
    assets: dict[str, ImportedFile] = field(default_factory=dict)
    issues: list[ConversionIssue] = field(default_factory=list)
    source_sha256: str | None = None
