"""Versioned, bounded native slide document shared by editing and PPTX export."""

from datetime import datetime
from typing import Literal

from pydantic import Field, PrivateAttr, model_validator

from app.apps.presentation_workshop.schemas.annotations import (
    PresentationAnnotation,
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
from app.apps.presentation_workshop.schemas.playback import (
    PresentationAnimation,
    PresentationTransition,
)
from app.apps.presentation_workshop.schemas.scene import (
    PresentationConnection,
    PresentationGroup,
    PresentationInfographic,
    PresentationReference,
    validate_scene,
)
from app.apps.presentation_workshop.schemas.values import Color, Identifier, SlideModel
from app.apps.presentation_workshop.templates.schema import (
    PageType,
    PresentationChapter,
    TemplateBinding,
    TemplateOverrides,
    effective_template,
)

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


class PresentationSlide(SlideModel):
    id: Identifier
    background: Color
    notes: str = Field(max_length=20000)
    elements: list[PresentationElement] = Field(max_length=300)
    groups: list[PresentationGroup] = Field(default_factory=list, max_length=200)
    connections: list[PresentationConnection] = Field(default_factory=list, max_length=200)
    infographics: list[PresentationInfographic] = Field(default_factory=list, max_length=50)
    reference: PresentationReference | None = None
    image_asset_id: Identifier | None = Field(
        default=None,
        description="Archived Workspace image; excluded from slide rendering and PPTX.",
    )
    animations: list[PresentationAnimation] = Field(default_factory=list, max_length=600)
    transition: PresentationTransition | None = None
    background_style: PresentationPaint | None = None
    section: str = Field(default_factory=str, max_length=120)
    page_type: PageType = Field(default_factory=lambda: "content")
    title: str = Field(default_factory=str, max_length=500)
    chapter_id: Identifier | None = None
    template_hidden: list[Identifier] = Field(default_factory=list, max_length=45)
    toc_offset: int = Field(default_factory=lambda: 0, ge=0, le=100)
    notes_rich: list[PresentationParagraph] | None = Field(default=None, max_length=200)
    annotations: list[PresentationAnnotation] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def scene_integrity(self):
        if self.notes_rich is not None and self.notes != "\n".join(
            "".join(r.text for r in p.runs) for p in self.notes_rich
        ):
            raise ValueError("富文本备注的纯文本与内容必须一致")
        identities = {e.id for e in self.elements}
        if any(a.element_id and a.element_id not in identities for a in self.annotations):
            raise ValueError("批注必须引用当前页面的元素")
        if any(animation.element_id not in identities for animation in self.animations):
            raise ValueError("动画必须引用当前页面中存在的元素")
        if len({a.id for a in self.animations}) != len(self.animations):
            raise ValueError("页面动画 ID 必须唯一")
        return validate_scene(self)


class PresentationDocument(SlideModel):
    version: Literal[2, 3, 4]
    width: int = Field(ge=320, le=4096)
    height: int = Field(ge=240, le=4096)
    slides: list[PresentationSlide] = Field(min_length=1, max_length=100)
    template: TemplateBinding | None = None
    template_overrides: TemplateOverrides = Field(default_factory=TemplateOverrides)
    chapters: list[PresentationChapter] = Field(default_factory=list, max_length=100)
    _source_version: int = PrivateAttr(default=3)

    @model_validator(mode="wrap")
    @classmethod
    def upgrade_legacy(cls, value, handler):
        version = value.get("version") if isinstance(value, dict) else getattr(value, "version", 3)
        result = handler({**value, "version": 3} if version in {1, 2} else value)
        result._source_version = version
        return result

    @property
    def source_version(self):
        return self._source_version

    def needs_v4(self):
        return bool(
            self.template
            or self.chapters
            or self.template_overrides != TemplateOverrides()
            or any(
                s.title
                or s.chapter_id
                or s.page_type != "content"
                or s.template_hidden
                or s.toc_offset
                for s in self.slides
            )
        )

    def needs_v3(self):
        return (
            self.width != 1280
            or self.height != 720
            or any(
                s.animations
                or s.transition
                or s.background_style
                or s.section
                or s.notes_rich is not None
                or s.annotations
                for s in self.slides
            )
            or any(
                e.name
                or e.hidden
                or e.paint
                or e.shadow
                or e.text_layout
                or e.image_effects
                or e.path
                or e.link
                or any(
                    p.indent
                    or p.first_line_indent
                    or p.space_before
                    or p.space_after
                    or any(
                        r.strike or r.highlight or r.script != "normal" or r.code for r in p.runs
                    )
                    for p in e.paragraphs
                )
                or e.kind in {"table", "chart", "formula", "video", "audio"}
                for s in self.slides
                for e in s.elements
            )
        )

    @model_validator(mode="after")
    def unique_ids_and_size(self):
        if self.version < 4 and self.needs_v4():
            raise ValueError("模板和页面语义需要 v4 文稿")
        if any(len(s.elements) > 200 for s in self.slides) and (self.version < 4 or self.template):
            raise ValueError("正文每页最多 200 个元素；解绑后的模板外观最多可保留 300 个元素")
        if (self.version < 4 or self.template) and any(
            c.layer > 200 for s in self.slides for c in s.connections
        ):
            raise ValueError("正文连接层级不能超过 200")
        chapter_ids = [chapter.id for chapter in self.chapters]
        if len(chapter_ids) != len(set(chapter_ids)):
            raise ValueError("章节 ID 必须唯一")
        if any(s.chapter_id and s.chapter_id not in chapter_ids for s in self.slides):
            raise ValueError("页面引用的章节不存在")
        if self.template:
            definition = effective_template(self.template, self.template_overrides)
            if (definition.width, definition.height) != (self.width, self.height):
                raise ValueError("模板尺寸必须与文稿一致")
        if self.template and any(
            e.id.startswith("master-") for s in self.slides for e in s.elements
        ):
            raise ValueError("master- 为模板解析层保留的元素前缀")
        ids = [slide.id for slide in self.slides]
        ids += [element.id for slide in self.slides for element in slide.elements]
        ids += [
            item.id
            for slide in self.slides
            for items in (slide.groups, slide.connections, slide.infographics)
            for item in items
        ]
        ids += [a.id for s in self.slides for a in s.animations]
        ids += [
            identity
            for s in self.slides
            for a in s.annotations
            for identity in (a.id, *(r.id for r in a.replies))
        ]
        slide_ids = {s.id for s in self.slides}
        if any(
            e.link and e.link.type == "slide" and e.link.target not in slide_ids
            for s in self.slides
            for e in s.elements
        ):
            raise ValueError("页面超链接指向不存在的页面")
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
    width: int = 1280
    height: int = 720


class PresentationProjectList(SlideModel):
    items: list[PresentationProjectSummary]
    total: int


class PresentationExportIn(SlideModel):
    expected_revision: int = Field(ge=0)
