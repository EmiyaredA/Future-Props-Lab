"""Native template layers; independent of the document containing a snapshot."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from studio.apps.presentation_workshop.schemas.elements import PresentationElement
from studio.apps.presentation_workshop.schemas.scene import (
    PresentationConnection,
    PresentationGroup,
    PresentationInfographic,
    validate_scene,
)
from studio.apps.presentation_workshop.schemas.values import Identifier, SlideModel


class TemplateSemantic(SlideModel):
    element_id: Identifier
    role: Literal["chapter", "title", "number", "toc"]


class TemplateScene(SlideModel):
    page_types: dict[
        Identifier,
        Annotated[
            list[Literal["cover", "toc", "section", "content", "ending"]], Field(max_length=5)
        ],
    ] = Field(default_factory=dict, max_length=100)
    elements: list[PresentationElement] = Field(default_factory=list, max_length=100)
    groups: list[PresentationGroup] = Field(default_factory=list, max_length=100)
    connections: list[PresentationConnection] = Field(default_factory=list, max_length=100)
    infographics: list[PresentationInfographic] = Field(default_factory=list, max_length=30)
    semantics: list[TemplateSemantic] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def integrity(self):
        validate_scene(self)
        ids = {e.id for e in self.elements}
        if set(self.page_types) - ids:
            raise ValueError("页型显示规则必须引用场景对象")
        if len(ids) != len(self.elements):
            raise ValueError("模板场景对象 ID 不能重复")
        if len({s.role for s in self.semantics}) != len(self.semantics) or len(
            {s.element_id for s in self.semantics}
        ) != len(self.semantics):
            raise ValueError("每个动态槽位必须关联一个独立对象")
        texts = {e.id for e in self.elements if e.kind == "text"}
        if any(s.element_id not in texts for s in self.semantics):
            raise ValueError("动态槽位必须关联场景中的原生文本对象")
        if any(
            not e.paragraphs[0].runs
            for e in self.elements
            if e.id in {s.element_id for s in self.semantics}
        ):
            raise ValueError("动态槽位必须保留文字样式")
        if any(e.link and e.link.type == "slide" for e in self.elements):
            raise ValueError("模板不能链接尚未创建的文稿页面")
        return self


class LayoutObjectLink(SlideModel):
    element_id: Identifier
    default_id: Identifier


class PresentationLayoutSource(SlideModel):
    template_id: str | None = None
    template_revision: int = Field(ge=0)
    page_type: Literal["cover", "toc", "section", "content", "ending"]
    objects: list[LayoutObjectLink] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def unique_links(self):
        if len({o.element_id for o in self.objects}) != len(self.objects) or len(
            {o.default_id for o in self.objects}
        ) != len(self.objects):
            raise ValueError("版式对象映射必须一一对应")
        return self
