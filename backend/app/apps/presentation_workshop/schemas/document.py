"""Versioned, bounded native slide document shared by editing and PPTX export."""

from datetime import datetime
from typing import Literal

from pydantic import Field, PrivateAttr, model_validator

from app.apps.presentation_workshop.schemas.annotations import (
    PresentationAnnotation,
)
from app.apps.presentation_workshop.schemas.appearance import PresentationPaint
from app.apps.presentation_workshop.schemas.elements import (
    PresentationCrop as PresentationCrop,
)
from app.apps.presentation_workshop.schemas.elements import (
    PresentationElement,
    PresentationParagraph,
)
from app.apps.presentation_workshop.schemas.elements import (
    PresentationRun as PresentationRun,
)
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
from app.apps.presentation_workshop.templates.scenes import PresentationLayoutSource
from app.apps.presentation_workshop.templates.schema import (
    PageType,
    PresentationChapter,
    TemplateBinding,
    TemplateOverrides,
    effective_template,
)


class PresentationSlide(SlideModel):
    layout_source: PresentationLayoutSource | None = None
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
        description="Archived account image; excluded from slide rendering and PPTX.",
    )
    animations: list[PresentationAnimation] = Field(default_factory=list, max_length=600)
    transition: PresentationTransition | None = None
    background_style: PresentationPaint | None = None
    section: str = Field(default_factory=str, max_length=120)
    page_type: PageType = Field(default_factory=lambda: "content")
    title: str = Field(default_factory=str, max_length=500)
    chapter_id: Identifier | None = None
    template_hidden: list[Identifier] = Field(default_factory=list, max_length=110)
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
        if self.layout_source and any(
            o.element_id not in identities for o in self.layout_source.objects
        ):
            raise ValueError("版式映射必须引用本页现有对象")
        if any(a.element_id and a.element_id not in identities for a in self.annotations):
            raise ValueError("批注必须引用当前页面的元素")
        if any(animation.element_id not in identities for animation in self.animations):
            raise ValueError("动画必须引用当前页面中存在的元素")
        if len({a.id for a in self.animations}) != len(self.animations):
            raise ValueError("页面动画 ID 必须唯一")
        return validate_scene(self)


class PresentationDocument(SlideModel):
    version: Literal[2, 3, 4, 5]
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

    def needs_v5(self):
        return bool(
            (self.template and self.template.snapshot.version >= 2)
            or self.template_overrides.global_scene is not None
            or any(s.layout_source for s in self.slides)
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
        if self.version < 5 and self.needs_v5():
            raise ValueError("原生模板布局需要 v5 文稿")
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
