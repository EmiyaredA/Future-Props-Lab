"""Portable template definitions. No document or persistence dependencies."""

from typing import Literal

from pydantic import Field, model_validator

from studio.apps.presentation_workshop.schemas.values import Color, Identifier, SlideModel
from studio.apps.presentation_workshop.templates.scenes import TemplateScene

PageType = Literal["cover", "toc", "section", "content", "ending"]
PAGE_TYPES = ["cover", "toc", "section", "content", "ending"]
Font = Literal["Microsoft YaHei", "Arial", "Consolas"]


class TemplateTextStyle(SlideModel):
    font: Font = "Microsoft YaHei"
    size: float = Field(default=32, ge=6, le=240)
    color: Color = "#142B45"
    bold: bool = False
    align: Literal["left", "center", "right"] = "left"


class TemplateSlot(SlideModel):
    x: float = Field(default=64, ge=0, le=4096)
    y: float = Field(default=88, ge=0, le=4096)
    width: float = Field(default=1152, ge=1, le=4096)
    height: float = Field(default=64, ge=1, le=4096)
    style: TemplateTextStyle = Field(default_factory=TemplateTextStyle)
    visible: bool = True


class TemplateFixedElement(SlideModel):
    id: Identifier
    kind: Literal["text", "image", "rect"] = "text"
    text: str = Field(default="", max_length=2000)
    asset_id: Identifier | None = None
    x: float = Field(default=64, ge=0, le=4096)
    y: float = Field(default=640, ge=0, le=4096)
    width: float = Field(default=160, ge=1, le=4096)
    height: float = Field(default=40, ge=1, le=4096)
    style: TemplateTextStyle = Field(default_factory=TemplateTextStyle)
    fill: Color = "#FFFFFF"
    opacity: float = Field(default=1, ge=0, le=1)
    layer: Literal["behind", "front"] = "front"
    page_types: list[PageType] = Field(default_factory=lambda: list(PAGE_TYPES), max_length=5)

    @model_validator(mode="after")
    def image_reference(self):
        if (self.kind == "image") != (self.asset_id is not None):
            raise ValueError("固定图片必须选择托管素材，文字和形状不能引用图片")
        return self


class TemplatePageLayout(SlideModel):
    scene: TemplateScene = Field(default_factory=TemplateScene)
    defaults: TemplateScene = Field(default_factory=TemplateScene)
    background: Color = "#FAF8F3"
    background_asset_id: Identifier | None = None
    chapter: TemplateSlot = Field(
        default_factory=lambda: TemplateSlot(y=36, height=32, style=TemplateTextStyle(size=20))
    )
    title: TemplateSlot = Field(
        default_factory=lambda: TemplateSlot(style=TemplateTextStyle(size=44, bold=True))
    )
    number: TemplateSlot = Field(
        default_factory=lambda: TemplateSlot(
            x=1116,
            y=672,
            width=100,
            height=24,
            style=TemplateTextStyle(size=14, color="#7B8794", align="right"),
        )
    )
    toc: TemplateSlot = Field(
        default_factory=lambda: TemplateSlot(y=192, height=408, style=TemplateTextStyle(size=28))
    )
    toc_capacity: int = Field(default=7, ge=1, le=20)
    body_top: float = Field(default=176, ge=0, le=4096)


def default_layouts():
    layouts = {kind: TemplatePageLayout() for kind in PAGE_TYPES}
    for kind in ("cover", "ending", "section"):
        layouts[kind].title.y = 264
        layouts[kind].title.height = 100
        layouts[kind].title.style.size = 56
        layouts[kind].chapter.y = 208
        layouts[kind].body_top = 400
    for layout in layouts.values():
        layout.chapter.style.color = "#EC805B"
    layouts["ending"].chapter.visible = False
    return layouts


class TemplateDefinition(SlideModel):
    version: Literal[1, 2] = 1
    global_scene: TemplateScene = Field(default_factory=TemplateScene)
    width: int = Field(default=1280, ge=320, le=4096)
    height: int = Field(default=720, ge=240, le=4096)
    font: Font = "Microsoft YaHei"
    foreground: Color = "#142B45"
    accent: Color = "#EC805B"
    number_start: int = Field(default=1, ge=0, le=9999)
    number_total: bool = False
    number_hidden_types: list[PageType] = Field(default_factory=lambda: ["cover"], max_length=5)
    layouts: dict[PageType, TemplatePageLayout] = Field(default_factory=default_layouts)
    fixed: list[TemplateFixedElement] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def complete(self):
        if self.version == 1 and (
            self.global_scene != TemplateScene()
            or any(
                layout.scene != TemplateScene() or layout.defaults != TemplateScene()
                for layout in self.layouts.values()
            )
        ):
            raise ValueError("原生模板场景需要 v2 模板")
        if self.global_scene.semantics or any(
            layout.defaults.semantics for layout in self.layouts.values()
        ):
            raise ValueError("动态槽位只属于页型固定层")
        if set(self.layouts) != set(PAGE_TYPES):
            raise ValueError("模板必须包含封面、目录、章节、内容和结束五种页型")
        ids = [item.id for item in self.fixed]
        if len(ids) != len(set(ids)) or set(ids) & {
            "chapter",
            "title",
            "number",
            "toc",
            "background",
        }:
            raise ValueError("固定元素 ID 必须唯一，且不能使用保留槽位名称")
        for layout in self.layouts.values():
            if {e.id for e in self.global_scene.elements} & {e.id for e in layout.scene.elements}:
                raise ValueError("全局固定层与页型固定层不能使用相同对象 ID")
            if len(self.global_scene.elements) + len(layout.scene.elements) > 100:
                raise ValueError("全局固定层和页型固定层合计最多 100 个对象")
            for slot in (layout.chapter, layout.title, layout.number, layout.toc):
                if slot.x + slot.width > self.width or slot.y + slot.height > self.height:
                    raise ValueError("模板槽位不能超出页面")
        for item in self.fixed:
            if item.x + item.width > self.width or item.y + item.height > self.height:
                raise ValueError("固定元素不能超出页面")
        return self


class PresentationChapter(SlideModel):
    id: Identifier
    title: str = Field(min_length=1, max_length=120)


class TemplateBinding(SlideModel):
    template_id: str | None = None
    template_revision: int = Field(default=0, ge=0)
    name: str = Field(min_length=1, max_length=120)
    snapshot: TemplateDefinition


class TemplateOverrides(SlideModel):
    """Explicit replacement fields; absence follows the pinned template."""

    font: Font | None = None
    foreground: Color | None = None
    accent: Color | None = None
    number_start: int | None = Field(default=None, ge=0, le=9999)
    number_total: bool | None = None
    number_hidden_types: list[PageType] | None = Field(default=None, max_length=5)
    layouts: dict[PageType, TemplatePageLayout] = Field(default_factory=dict)
    fixed: list[TemplateFixedElement] | None = Field(default=None, max_length=40)
    global_scene: TemplateScene | None = None


def effective_template(
    binding: TemplateBinding, overrides: TemplateOverrides
) -> TemplateDefinition:
    data = binding.snapshot.model_dump()
    for key, value in overrides.model_dump().items():
        if value is None:
            continue
        if key == "layouts":
            data[key].update(value)
        else:
            data[key] = value
    return TemplateDefinition.model_validate(data)
