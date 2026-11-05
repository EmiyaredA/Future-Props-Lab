from datetime import datetime
from typing import Literal

from pydantic import Field

from studio.apps.presentation_workshop.schemas.document import PresentationDocument
from studio.apps.presentation_workshop.schemas.values import Identifier, SlideModel
from studio.apps.presentation_workshop.templates.scenes import LayoutObjectLink
from studio.apps.presentation_workshop.templates.schema import (
    PageType,
    PresentationChapter,
    TemplateDefinition,
)


class TemplateLayoutMapping(SlideModel):
    slide_id: Identifier
    page_type: PageType
    objects: list[LayoutObjectLink] = Field(min_length=1, max_length=200)


class PresentationTemplateIn(SlideModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    definition: TemplateDefinition


class PresentationTemplatePut(PresentationTemplateIn):
    expected_revision: int = Field(ge=0)


class PresentationTemplateOut(PresentationTemplateIn):
    id: str
    revision: int
    created_at: datetime
    updated_at: datetime


class PresentationTemplateList(SlideModel):
    items: list[PresentationTemplateOut]
    total: int


class PresentationExampleIn(SlideModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    document: PresentationDocument


class PresentationExamplePut(PresentationExampleIn):
    expected_revision: int = Field(ge=0)


class PresentationExampleOut(PresentationExampleIn):
    id: str
    revision: int
    created_at: datetime
    updated_at: datetime


class PresentationExampleList(SlideModel):
    items: list[PresentationExampleOut]
    total: int


class TemplateCreateDocument(SlideModel):
    title: str = Field(min_length=1, max_length=120)
    expected_revision: int = Field(ge=0)


class TemplatePageMapping(SlideModel):
    slide_id: Identifier
    title: str = Field(default="", max_length=500)
    chapter_id: Identifier | None = None
    page_type: PageType = "content"
    title_element_ids: list[Identifier] = Field(default_factory=list, max_length=30)
    # Explicit IDs only. The API never infers removals from typography.


class TemplateChangeIn(SlideModel):
    expected_revision: int = Field(ge=0)
    template_id: str | None = None
    template_revision: int | None = Field(default=None, ge=0)
    action: Literal["bind", "update", "unbind", "layout"] = "bind"
    layout_mappings: list[TemplateLayoutMapping] = Field(default_factory=list, max_length=100)
    apply_text_style: bool = Field(default_factory=lambda: False)
    mappings: list[TemplatePageMapping] = Field(default_factory=list, max_length=100)
    chapters: list[PresentationChapter] | None = Field(default=None, max_length=100)


class TemplateChangeApply(TemplateChangeIn):
    preview_token: str = Field(min_length=64, max_length=64)


class TemplateChangePreview(SlideModel):
    document_revision: int
    template_revision: int | None
    preview_token: str
    changes: list[str]
    affected_slides: list[str]
    issues: list[dict]
    document: PresentationDocument


class TemplateBundleIn(SlideModel):
    template: PresentationTemplateIn
    example: PresentationExampleIn


class TemplateBundleOut(SlideModel):
    template: PresentationTemplateOut
    example: PresentationExampleOut
