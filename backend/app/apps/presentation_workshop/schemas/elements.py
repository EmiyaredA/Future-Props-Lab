"""Native text and object contract shared by documents and template scenes."""

from typing import Literal

from pydantic import Field, model_validator

from app.apps.presentation_workshop.schemas.annotations import (
    PresentationLink,
)
from app.apps.presentation_workshop.schemas.appearance import (
    PresentationImageEffects,
    PresentationPaint,
    PresentationShadow,
    PresentationTextLayout,
)
from app.apps.presentation_workshop.schemas.objects import (
    PresentationChart,
    PresentationFormula,
    PresentationMedia,
    PresentationTable,
)
from app.apps.presentation_workshop.schemas.paths import PresentationPath
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
    strike: bool = Field(default_factory=lambda: False)
    highlight: Color | None = None
    script: Literal["normal", "sup", "sub"] = Field(default_factory=lambda: "normal")
    code: bool = Field(default_factory=lambda: False)


class PresentationParagraph(SlideModel):
    runs: list[PresentationRun] = Field(max_length=1000)
    align: Literal["left", "center", "right"]
    line_height: float = Field(ge=1, le=3)
    bullet: bool
    numbered: bool = Field(
        default=False, description="Decimal list item; mutually exclusive with bullet."
    )
    indent: int = Field(default_factory=lambda: 0, ge=0, le=8)
    first_line_indent: float = Field(default_factory=lambda: 0, ge=-100, le=100)
    space_before: float = Field(default_factory=lambda: 0, ge=0, le=120)
    space_after: float = Field(default_factory=lambda: 0, ge=0, le=120)

    @model_validator(mode="after")
    def list_marker(self):
        if self.bullet and self.numbered:
            raise ValueError("段落不能同时使用项目符号和编号")
        return self


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
    name: str = Field(default="", max_length=120)
    hidden: bool = False
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
        "table",
        "chart",
        "formula",
        "video",
        "audio",
        "path",
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
    table: PresentationTable | None = None
    chart: PresentationChart | None = None
    formula: PresentationFormula | None = None
    media: PresentationMedia | None = None
    paint: PresentationPaint | None = None
    shadow: PresentationShadow | None = None
    text_layout: PresentationTextLayout | None = None
    image_effects: PresentationImageEffects | None = None
    path: PresentationPath | None = None
    link: PresentationLink | None = None

    @model_validator(mode="after")
    def content_matches_kind(self):
        if self.kind != "vector" and self.vector_color is not None:
            raise ValueError("只有矢量元素可以统一改色")
        if (self.kind in {"image", "vector", "formula", "video", "audio"}) != (
            self.asset_id is not None
        ):
            raise ValueError("图片、视频和音频元素必须引用对应素材")
        for field, kinds in (
            ("table", {"table"}),
            ("chart", {"chart"}),
            ("formula", {"formula"}),
            ("media", {"video", "audio"}),
            ("path", {"path"}),
        ):
            if (self.kind in kinds) != (getattr(self, field) is not None):
                raise ValueError(f"{field} 专属内容与元素类型不匹配")
        if (
            self.kind
            in {"image", "vector", "formula", "audio", "video", "table", "chart", "line", "path"}
            and self.paragraphs
        ):
            raise ValueError("此类元素不能直接包含段落")
        if self.image_effects and self.kind != "image":
            raise ValueError("图片滤镜只能用于图片元素")
        if self.text_layout and self.kind in {
            "image",
            "vector",
            "formula",
            "audio",
            "video",
            "table",
            "chart",
            "line",
            "path",
        }:
            raise ValueError("文字布局只能用于文本框和形状")
        if self.kind == "text" and not self.paragraphs:
            raise ValueError("文本框至少包含一个段落")
        return self
