from typing import Literal

from pydantic import Field, model_validator

from studio.apps.presentation_workshop.schemas.values import Color, Identifier, SlideModel


class PresentationGroup(SlideModel):
    id: Identifier
    name: str = Field(default="分组", max_length=120)
    element_ids: list[Identifier] = Field(default_factory=list, max_length=200)
    parent_id: Identifier | None = None


class PresentationPoint(SlideModel):
    x: float = Field(ge=-10000, le=10000)
    y: float = Field(ge=-10000, le=10000)


class PresentationConnection(SlideModel):
    id: Identifier
    source_id: Identifier | None = None
    target_id: Identifier | None = None
    source_point: PresentationPoint | None = None
    target_point: PresentationPoint | None = None
    source_anchor: Literal["left", "right", "top", "bottom"] = "right"
    target_anchor: Literal["left", "right", "top", "bottom"] = "left"
    source_offset: float = Field(
        default=0.5,
        ge=0,
        le=1,
        description="沿起点所在边的位置比例；左右边从上到下，上下边从左到右",
    )
    target_offset: float = Field(
        default=0.5,
        ge=0,
        le=1,
        description="沿终点所在边的位置比例；左右边从上到下，上下边从左到右",
    )
    style: Literal["straight", "step"] = "step"
    label: str = Field(default="", max_length=500)
    color: Color = "#365F62"
    width: float = Field(default=2, ge=0.5, le=30)
    arrow: bool = True
    # Number of page elements below this connection; ties follow connection order.
    layer: int = Field(default=0, ge=0, le=300)
    waypoints: list[PresentationPoint] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def distinct_ends(self):
        for end in ("source", "target"):
            if (getattr(self, f"{end}_id") is None) == (getattr(self, f"{end}_point") is None):
                raise ValueError("每个连接端点必须且只能指定节点或自由坐标")
        if self.source_id is not None and self.source_id == self.target_id:
            raise ValueError("连接的两个节点必须不同")
        return self


class PresentationReference(SlideModel):
    asset_id: Identifier
    opacity: float = Field(default=0.35, ge=0.05, le=1)
    mode: Literal["side", "overlay"] = "side"
    visible: bool = True


class PresentationInfographic(SlideModel):
    id: Identifier
    group_id: Identifier
    format: Literal["antv", "scene"]
    template: str = Field(default="", max_length=120)
    source: str = Field(max_length=50000)


def validate_scene(slide):
    elements = {e.id: e for e in slide.elements}
    groups = {g.id: g for g in slide.groups}
    ids = list(elements) + [g.id for g in slide.groups]
    ids += [c.id for c in slide.connections] + [i.id for i in slide.infographics]
    if len(ids) != len(set(ids)):
        raise ValueError("页面内元素、组、连接和信息图 ID 必须唯一")
    owners = set()
    for group in slide.groups:
        if len(group.element_ids) != len(set(group.element_ids)):
            raise ValueError("分组成员不能重复")
        for identity in group.element_ids:
            if identity not in elements or identity in owners:
                raise ValueError("分组成员不存在或已属于其他组")
            owners.add(identity)
        visited = {group.id}
        parent = group.parent_id
        while parent:
            if parent not in groups or parent in visited:
                raise ValueError("分组父级不存在或形成循环")
            visited.add(parent)
            parent = groups[parent].parent_id
    for connection in slide.connections:
        for identity in (connection.source_id, connection.target_id):
            if identity is not None and (
                identity not in elements or elements[identity].kind == "line"
            ):
                raise ValueError("连接节点不存在或不是可连接元素")
    provenance_groups = [i.group_id for i in slide.infographics]
    if len(provenance_groups) != len(set(provenance_groups)):
        raise ValueError("每个信息图必须拥有独立分组")
    if any(identity not in groups for identity in provenance_groups):
        raise ValueError("信息图分组不存在")
    return slide
