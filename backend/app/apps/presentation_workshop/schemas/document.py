"""Versioned, bounded native slide document shared by editing and PPTX export."""

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.apps.presentation_workshop.schemas.scene import (
    PresentationConnection,
    PresentationGroup,
    PresentationInfographic,
    PresentationReference,
    validate_scene,
)
from app.apps.presentation_workshop.schemas.values import Color, Identifier, SlideModel

Font = Literal["Microsoft YaHei", "Arial", "Consolas"]


class PresentationRun(SlideModel):
    text: str = Field(max_length=20000)
    font: Font
    size: float = Field(ge=6, le=240)
    color: Color
    bold: bool
    italic: bool
    underline: bool


class PresentationParagraph(SlideModel):
    runs: list[PresentationRun] = Field(max_length=1000)
    align: Literal["left", "center", "right"]
    line_height: float = Field(ge=1, le=3)
    bullet: bool


class PresentationCrop(SlideModel):
    left: float = Field(ge=0, lt=1)
    top: float = Field(ge=0, lt=1)
    right: float = Field(ge=0, lt=1)
    bottom: float = Field(ge=0, lt=1)

    @model_validator(mode="after")
    def visible_area(self):
        if self.left + self.right >= 0.99 or self.top + self.bottom >= 0.99:
            raise ValueError("图片裁剪必须保留可见区域")
        return self


class PresentationElement(SlideModel):
    id: Identifier
    kind: Literal[
        "text",
        "image",
        "vector",
        "rect",
        "roundRect",
        "ellipse",
        "triangle",
        "diamond",
        "arrow",
        "line",
        "rightTriangle",
        "pentagon",
        "hexagon",
        "star",
        "parallelogram",
        "trapezoid",
        "leftArrow",
        "upArrow",
        "downArrow",
        "doubleArrow",
        "callout",
        "roundCallout",
        "ellipseCallout",
    ]
    x: float = Field(ge=-10000, le=10000)
    y: float = Field(ge=-10000, le=10000)
    width: float = Field(ge=1, le=10000)
    height: float = Field(ge=1, le=10000)
    rotation: float = Field(ge=-360, le=360)
    opacity: float = Field(default=1, ge=0, le=1)
    flip_x: bool = False
    flip_y: bool = False
    vector_color: Color | None = None
    image_border: bool = False
    locked: bool
    fill: Color
    stroke: Color
    stroke_width: float = Field(ge=0, le=30)
    fill_opacity: float = Field(default=1, ge=0, le=1)
    stroke_dash: Literal["solid", "dash", "dot"] = "solid"
    start_arrow: Literal["none", "triangle", "open", "circle"] = "none"
    end_arrow: Literal["none", "triangle", "open", "circle"] = "none"
    corner_radius: float | None = Field(default=None, ge=0, le=5000)
    paragraphs: list[PresentationParagraph] = Field(max_length=200)
    asset_id: Identifier | None
    crop: PresentationCrop

    @model_validator(mode="after")
    def content_matches_kind(self):
        if self.kind != "vector" and self.vector_color is not None:
            raise ValueError("只有矢量元素可以统一改色")
        if (self.kind in {"image", "vector"}) != (self.asset_id is not None):
            raise ValueError("只有图片元素可以且必须引用图片")
        if self.kind != "text" and self.paragraphs:
            raise ValueError("只有文本元素可以包含文字")
        if self.kind == "text" and not self.paragraphs:
            raise ValueError("文本框至少包含一个段落")
        return self


class PresentationSlide(SlideModel):
    id: Identifier
    background: Color
    notes: str = Field(max_length=20000)
    elements: list[PresentationElement] = Field(max_length=200)
    groups: list[PresentationGroup] = Field(default_factory=list, max_length=200)
    connections: list[PresentationConnection] = Field(default_factory=list, max_length=200)
    infographics: list[PresentationInfographic] = Field(default_factory=list, max_length=50)
    reference: PresentationReference | None = None
    image_asset_id: Identifier | None = Field(
        default=None,
        description="Archived Workspace image; excluded from slide rendering and PPTX.",
    )

    @model_validator(mode="after")
    def scene_integrity(self):
        return validate_scene(self)


class PresentationDocument(SlideModel):
    version: Literal[2]
    width: Literal[1280]
    height: Literal[720]
    slides: list[PresentationSlide] = Field(min_length=1, max_length=100)

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy(cls, value):
        if isinstance(value, dict) and value.get("version") == 1:
            return {**value, "version": 2}
        return value

    @model_validator(mode="after")
    def unique_ids_and_size(self):
        ids = [slide.id for slide in self.slides]
        ids += [element.id for slide in self.slides for element in slide.elements]
        ids += [
            item.id
            for slide in self.slides
            for items in (slide.groups, slide.connections, slide.infographics)
            for item in items
        ]
        if len(ids) != len(set(ids)):
            raise ValueError("页面和元素 ID 必须唯一")
        if len(self.model_dump_json().encode()) > 8 * 1024 * 1024:
            raise ValueError("文稿结构不能超过 8 MiB")
        return self


class PresentationProjectIn(SlideModel):
    title: str = Field(min_length=1, max_length=120)
    document: PresentationDocument


class PresentationProjectPut(PresentationProjectIn):
    expected_revision: int = Field(ge=0)


class PresentationProjectOut(PresentationProjectIn):
    id: str
    revision: int
    created_at: datetime
    updated_at: datetime


class PresentationProjectSummary(SlideModel):
    id: str
    title: str
    revision: int
    updated_at: datetime
    slide_count: int
    first_slide: PresentationSlide


class PresentationProjectList(SlideModel):
    items: list[PresentationProjectSummary]
    total: int


class PresentationExportIn(SlideModel):
    expected_revision: int = Field(ge=0)
