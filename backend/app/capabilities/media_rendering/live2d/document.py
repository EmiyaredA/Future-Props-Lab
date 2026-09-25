"""Versioned native character format; not a Cubism binary compiler."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Number = Annotated[float, Field(allow_inf_nan=False, ge=-100000, le=100000)]
Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")]


class ValueModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)


class Point(ValueModel):
    x: Number
    y: Number


class CharacterPart(ValueModel):
    id: Identifier
    name: str = Field(min_length=1, max_length=120)
    asset_id: Identifier = Field(alias="assetId")
    group: str = Field(default="", max_length=512)
    parent_id: Identifier | None = Field(default=None, alias="parentId")
    x: Number = 0
    y: Number = 0
    width: float = Field(gt=0, le=8192)
    height: float = Field(gt=0, le=8192)
    vertices: list[Point] = Field(min_length=3, max_length=4096)
    uvs: list[Point] = Field(min_length=3, max_length=4096)
    triangles: list[int] = Field(min_length=3, max_length=24576)
    opacity: float = Field(default=1, ge=0, le=1)
    order: int = Field(default=0, ge=-10000, le=10000)
    visible: bool = True
    locked: bool = False
    mask_id: Identifier | None = Field(default=None, alias="maskId")

    @model_validator(mode="after")
    def mesh_valid(self) -> CharacterPart:
        if len(self.vertices) != len(self.uvs) or len(self.triangles) % 3:
            raise ValueError("网格顶点、UV 或三角形数量无效")
        if any(i < 0 or i >= len(self.vertices) for i in self.triangles):
            raise ValueError("网格索引越界")
        if any(not 0 <= p.x <= 1 or not 0 <= p.y <= 1 for p in self.uvs):
            raise ValueError("UV 必须位于 0 到 1")
        return self


class CharacterDeformer(ValueModel):
    id: Identifier
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["rotation", "warp"]
    parent_id: Identifier | None = Field(default=None, alias="parentId")
    x: Number = 0
    y: Number = 0
    rotation: Number = 0
    scale: float = Field(default=1, gt=0, le=100)
    width: float = Field(default=500, gt=0, le=8192)
    height: float = Field(default=500, gt=0, le=8192)
    columns: int = Field(default=2, ge=1, le=16)
    rows: int = Field(default=2, ge=1, le=16)
    points: list[Point] = Field(default_factory=list, max_length=289)

    @model_validator(mode="after")
    def grid_valid(self) -> CharacterDeformer:
        if self.kind == "warp" and len(self.points) != (self.columns + 1) * (self.rows + 1):
            raise ValueError("曲面控制点数量与网格不匹配")
        return self


class ParameterKeyform(ValueModel):
    value: Number
    points: list[Point] | None = Field(default=None, max_length=4096)
    rotation: Number | None = None
    scale: float | None = Field(default=None, gt=0, le=100)
    opacity: float | None = Field(default=None, ge=0, le=1)


class ParameterBinding(ValueModel):
    target_id: Identifier = Field(alias="targetId")
    keys: list[ParameterKeyform] = Field(min_length=1, max_length=32)


class CharacterParameter(ValueModel):
    id: Identifier
    name: str = Field(min_length=1, max_length=120)
    minimum: Number = -30
    maximum: Number = 30
    default: Number = 0
    bindings: list[ParameterBinding] = Field(default_factory=list, max_length=256)

    @model_validator(mode="after")
    def range_valid(self) -> CharacterParameter:
        if not self.minimum <= self.default <= self.maximum or self.minimum == self.maximum:
            raise ValueError("参数默认值或范围无效")
        if len({b.target_id for b in self.bindings}) != len(self.bindings):
            raise ValueError("参数目标重复")
        for binding in self.bindings:
            values = [k.value for k in binding.keys]
            if len(set(values)) != len(values) or any(
                not self.minimum <= v <= self.maximum for v in values
            ):
                raise ValueError("参数关键形位置重复或越界")
        return self


class CharacterExpression(ValueModel):
    id: Identifier
    name: str = Field(min_length=1, max_length=120)
    values: dict[str, Number] = Field(default_factory=dict, max_length=128)


class TimeKeyframe(ValueModel):
    frame: int = Field(ge=0, le=36000)
    value: Number
    interpolation: Literal["hold", "linear", "smooth"] = "linear"


class CharacterTrack(ValueModel):
    parameter_id: Identifier = Field(alias="parameterId")
    keys: list[TimeKeyframe] = Field(default_factory=list, max_length=1000)


class CharacterMotion(ValueModel):
    id: Identifier
    name: str = Field(min_length=1, max_length=120)
    fps: int = Field(default=30, ge=1, le=60)
    duration: int = Field(default=60, ge=1, le=36000)
    loop_start: int = Field(default=0, alias="loopStart", ge=0)
    loop_end: int = Field(default=60, alias="loopEnd", ge=1)
    tracks: list[CharacterTrack] = Field(default_factory=list, max_length=128)

    @model_validator(mode="after")
    def timeline_valid(self) -> CharacterMotion:
        if not self.loop_start < self.loop_end <= self.duration:
            raise ValueError("循环区间超出动作时长")
        if len({t.parameter_id for t in self.tracks}) != len(self.tracks):
            raise ValueError("动作轨道重复")
        for track in self.tracks:
            frames = [k.frame for k in track.keys]
            if len(set(frames)) != len(frames) or any(f > self.duration for f in frames):
                raise ValueError("时间关键帧重复或超出动作时长")
        return self


AmadeusState = Literal["idle", "listening", "thinking", "tool", "success", "error", "paused"]


class CharacterStateBinding(ValueModel):
    expression_id: Identifier | None = Field(default=None, alias="expressionId")
    motion_id: Identifier | None = Field(default=None, alias="motionId")


class CharacterDocument(ValueModel):
    schema_version: Literal[2] = Field(default=2, alias="schemaVersion")
    width: int = Field(default=1200, ge=32, le=4096)
    height: int = Field(default=1600, ge=32, le=4096)
    parts: list[CharacterPart] = Field(default_factory=list, max_length=128)
    deformers: list[CharacterDeformer] = Field(default_factory=list, max_length=128)
    parameters: list[CharacterParameter] = Field(default_factory=list, max_length=128)
    expressions: list[CharacterExpression] = Field(default_factory=list, max_length=128)
    motions: list[CharacterMotion] = Field(default_factory=list, max_length=128)
    state_bindings: dict[AmadeusState, CharacterStateBinding] = Field(
        default_factory=dict, alias="stateBindings", max_length=7
    )
    cubism_parameter_ids: dict[str, str] = Field(
        default_factory=dict, alias="cubismParameterIds", max_length=128
    )

    @model_validator(mode="before")
    @classmethod
    def upgrade_v1(cls, value: Any) -> Any:
        if isinstance(value, dict) and value.get("schemaVersion", 1) == 1:
            return {**value, "schemaVersion": 2}
        return value

    @model_validator(mode="after")
    def references_valid(self) -> CharacterDocument:
        for items in (self.parts + self.deformers, self.parameters, self.expressions, self.motions):
            if len({item.id for item in items}) != len(items):
                raise ValueError("对象 ID 重复")
        nodes = {n.id: n for n in self.parts + self.deformers}
        deformers = {n.id for n in self.deformers}
        parts = {n.id for n in self.parts}
        parameters = {p.id: p for p in self.parameters}
        for node in nodes.values():
            visited = {node.id}
            parent = node.parent_id
            while parent:
                if parent not in deformers or parent in visited:
                    raise ValueError("变形器父级不存在或形成循环")
                visited.add(parent)
                parent = nodes[parent].parent_id
        for part in self.parts:
            seen = {part.id}
            mask = part.mask_id
            while mask:
                if mask not in parts or mask in seen:
                    raise ValueError("遮罩不存在或形成循环")
                seen.add(mask)
                mask = nodes[mask].mask_id
        for parameter in self.parameters:
            for binding in parameter.bindings:
                target = nodes.get(binding.target_id)
                if target is None:
                    raise ValueError("绑定目标不存在")
                count = (
                    len(target.vertices)
                    if isinstance(target, CharacterPart)
                    else len(target.points)
                )
                fields = [
                    {
                        name
                        for name in ("points", "rotation", "scale", "opacity")
                        if getattr(k, name) is not None
                    }
                    for k in binding.keys
                ]
                if any(f != fields[0] for f in fields) or not fields[0]:
                    raise ValueError("同一绑定的关键形必须保存相同属性")
                allowed = (
                    {"points", "opacity"}
                    if isinstance(target, CharacterPart)
                    else ({"rotation", "scale"} if target.kind == "rotation" else {"points"})
                )
                if not fields[0] <= allowed:
                    raise ValueError("关键形属性不适用于此目标类型")
                for key in binding.keys:
                    if key.points is not None and len(key.points) != count:
                        raise ValueError("关键形与目标拓扑不匹配")
                    if isinstance(target, CharacterPart) and (
                        key.rotation is not None or key.scale is not None
                    ):
                        raise ValueError("旋转和缩放关键形仅用于旋转变形器")
        for expression in self.expressions:
            for key, value in expression.values.items():
                if (
                    key not in parameters
                    or not parameters[key].minimum <= value <= parameters[key].maximum
                ):
                    raise ValueError("表情参数不存在或越界")
        for motion in self.motions:
            for track in motion.tracks:
                parameter = parameters.get(track.parameter_id)
                if parameter is None or any(
                    not parameter.minimum <= k.value <= parameter.maximum for k in track.keys
                ):
                    raise ValueError("动画参数不存在或越界")
        expressions = {item.id for item in self.expressions}
        motions = {item.id for item in self.motions}
        for binding in self.state_bindings.values():
            if binding.expression_id and binding.expression_id not in expressions:
                raise ValueError("状态绑定的表情不存在")
            if binding.motion_id and binding.motion_id not in motions:
                raise ValueError("状态绑定的动作不存在")
        for native_id, external_id in self.cubism_parameter_ids.items():
            if native_id not in parameters or not 1 <= len(external_id) <= 120:
                raise ValueError("Cubism 参数映射无效")
        external_ids: set[str] = set()
        for native_id in parameters:
            external_id = self.cubism_parameter_ids.get(native_id, native_id)
            if external_id in external_ids:
                raise ValueError("Cubism 参数 ID 重复")
            external_ids.add(external_id)
        return self


def initial_document(width: int = 1200, height: int = 1600) -> CharacterDocument:
    presets = [
        ("ParamAngleX", "头部左右转", -30, 30, 0),
        ("ParamAngleY", "点头", -30, 30, 0),
        ("ParamEyeOpen", "眼睛开合", 0, 1, 1),
        ("ParamMouthOpenY", "嘴部开合", 0, 1, 0),
        ("ParamSmile", "微笑", 0, 1, 0),
        ("ParamBreath", "呼吸", 0, 1, 0),
    ]
    return CharacterDocument(
        width=width,
        height=height,
        parameters=[
            CharacterParameter(id=p[0], name=p[1], minimum=p[2], maximum=p[3], default=p[4])
            for p in presets
        ],
    )
